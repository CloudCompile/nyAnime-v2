import Foundation
import Metal
import MetalKit
import CoreGraphics
import NyAnimeCore

/// Renders one glass panel with Metal.
///
/// The pipeline mirrors `GlassRenderer` from `ybouane/liquidglass`: upload the
/// backdrop region behind the panel, copy it, run a separable Gaussian blur,
/// then shade the panel sampling both the sharp and blurred copies.
///
/// Render targets are cached and rebuilt only when the panel size changes, so
/// per-frame allocation — and therefore peak memory — stays flat. That matters
/// on the Intel GPU this app targets.
final class LiquidGlassRenderer {

    /// Everything is 8-bit BGRA: it matches the drawable and the SwiftUI
    /// compositing path, and it is the cheapest format the shader can sample.
    private static let pixelFormat = MTLPixelFormat.bgra8Unorm

    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let blitPipeline: MTLRenderPipelineState
    private let blurPipeline: MTLRenderPipelineState
    private let glassPipeline: MTLRenderPipelineState
    private let quadCorners: MTLBuffer
    private let panelCorners: MTLBuffer

    private var bgTexture: MTLTexture?
    private var blurTextureA: MTLTexture?
    private var blurTextureB: MTLTexture?
    private var stagingBuffer: MTLBuffer?
    private var cachedSize = SIMD2<Float>(0, 0)

    init?(device: MTLDevice) {
        guard let queue = device.makeCommandQueue() else { return nil }
        self.device = device
        self.commandQueue = queue

        guard let library = try? device.makeLibrary(
            source: LiquidGlassShaderSource.metal, options: nil
        ),
        let quadFn = library.makeFunction(name: "glass_quad_vertex"),
        let panelFn = library.makeFunction(name: "glass_panel_vertex"),
        let blitFn = library.makeFunction(name: "glass_blit_fragment"),
        let blurFn = library.makeFunction(name: "glass_blur_fragment"),
        let glassFn = library.makeFunction(name: "glass_fragment")
        else { return nil }

        func makePipeline(
            vertex: MTLFunction, fragment: MTLFunction, blend: Bool
        ) -> MTLRenderPipelineState? {
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = vertex
            descriptor.fragmentFunction = fragment
            guard let attachment = descriptor.colorAttachments[0] else { return nil }
            attachment.pixelFormat = Self.pixelFormat
            if blend {
                // The panel composites over whatever SwiftUI drew behind it, so
                // the shadow can fade out and the mask can anti-alias.
                attachment.isBlendingEnabled = true
                attachment.rgbBlendOperation = .add
                attachment.alphaBlendOperation = .add
                attachment.sourceRGBBlendFactor = .sourceAlpha
                attachment.sourceAlphaBlendFactor = .one
                attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
                attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            }
            return try? device.makeRenderPipelineState(descriptor: descriptor)
        }

        guard let blit = makePipeline(vertex: quadFn, fragment: blitFn, blend: false),
              let blur = makePipeline(vertex: quadFn, fragment: blurFn, blend: false),
              let glass = makePipeline(vertex: panelFn, fragment: glassFn, blend: true)
        else { return nil }

        blitPipeline = blit
        blurPipeline = blur
        glassPipeline = glass

        // Two quad variants, matching the original's buffers: a full-screen
        // quad for blit/blur, and a -0.5...0.5 panel quad for the glass pass.
        let quad: [Float] = [-1, -1, 1, -1, -1, 1, 1, 1]
        let panel: [Float] = [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]
        guard let quadBuffer = device.makeBuffer(
            bytes: quad, length: MemoryLayout<Float>.size * quad.count
        ),
        let panelBuffer = device.makeBuffer(
            bytes: panel, length: MemoryLayout<Float>.size * panel.count
        )
        else { return nil }
        quadCorners = quadBuffer
        panelCorners = panelBuffer
    }

    // MARK: - Drawing

    /// Renders one frame into `view`'s drawable.
    ///
    /// `backdrop` is the already-cropped, already-padded region of the window
    /// behind the panel, in the same device-pixel space as `drawableSize`.
    /// Passing `nil` still renders the panel, over black.
    ///
    /// `config` is in points; the backing scale factor is derived from the view
    /// so the shader, which works in device pixels, gets pixel lengths.
    func draw(in view: MTKView, backdrop: CGImage?, config: LiquidGlassConfig) {
        let size = SIMD2<Float>(
            Float(view.drawableSize.width), Float(view.drawableSize.height)
        )
        guard size.x >= 1, size.y >= 1 else { return }

        let bounds = view.bounds
        let scale: Float = bounds.width > 0
            ? Float(view.drawableSize.width / bounds.width)
            : Float(view.window?.backingScaleFactor ?? 2)

        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable
        else { return }

        ensureTargets(size: size)
        guard let bg = bgTexture, let blurA = blurTextureA, let blurB = blurTextureB
        else { return }

        // 1. Upload the backdrop behind the panel.
        if let backdrop {
            upload(backdrop, into: bg, commandBuffer: commandBuffer)
        } else {
            clear(bg, commandBuffer: commandBuffer)
        }

        // 2. Copy bg -> blurA, then blur it.
        copy(from: bg, to: blurA, commandBuffer: commandBuffer)

        if config.blurAmount > 0 {
            let spread = config.blurAmount * 2.5
            for _ in 0..<LiquidGlassMath.blurIterations {
                blur(from: blurA, to: blurB,
                     direction: SIMD2(spread / size.x, 0), commandBuffer: commandBuffer)
                blur(from: blurB, to: blurA,
                     direction: SIMD2(0, spread / size.y), commandBuffer: commandBuffer)
            }
        }

        // 3. Shade the panel into the drawable.
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].clearColor = MTLClearColor(
            red: 0, green: 0, blue: 0, alpha: 0
        )
        descriptor.colorAttachments[0].storeAction = .store

        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor)
        else { return }

        encoder.setRenderPipelineState(glassPipeline)
        encoder.setVertexBuffer(panelCorners, offset: 0, index: 0)

        // The Metal view is the panel plus `shadowPad` on every side, so the
        // panel itself is the drawable inset by that padding, centred. The
        // shader works from `size` (the panel) and `pad`, and places the result
        // in a `size + 2 * pad` quad — which is exactly the drawable.
        let padPixels = LiquidGlassMath.shadowPad * scale
        let panelSize = SIMD2<Float>(
            Swift.max(size.x - padPixels * 2, 1),
            Swift.max(size.y - padPixels * 2, 1)
        )

        var center = SIMD2<Float>(size.x * 0.5, size.y * 0.5)
        var quadSize = panelSize
        var resolution = size
        var pad = padPixels
        encoder.setVertexBytes(&center, length: MemoryLayout<SIMD2<Float>>.size, index: 1)
        encoder.setVertexBytes(&quadSize, length: MemoryLayout<SIMD2<Float>>.size, index: 2)
        encoder.setVertexBytes(&resolution, length: MemoryLayout<SIMD2<Float>>.size, index: 3)
        encoder.setVertexBytes(&pad, length: MemoryLayout<Float>.size, index: 4)

        var uniforms = LiquidGlassUniforms(
            config: config, size: panelSize, res: size, scale: scale
        )
        encoder.setFragmentBytes(
            &uniforms, length: MemoryLayout<LiquidGlassUniforms>.stride, index: 0
        )
        encoder.setFragmentTexture(bg, index: 0)
        encoder.setFragmentTexture(blurA, index: 1)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()

        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    // MARK: - Passes

    private func offscreenPass(_ texture: MTLTexture) -> MTLRenderPassDescriptor? {
        let descriptor = MTLRenderPassDescriptor()
        guard let attachment = descriptor.colorAttachments[0] else { return nil }
        attachment.texture = texture
        attachment.loadAction = .clear
        attachment.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        attachment.storeAction = .store
        return descriptor
    }

    private func copy(from source: MTLTexture, to destination: MTLTexture,
                      commandBuffer: MTLCommandBuffer) {
        guard let pass = offscreenPass(destination),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass)
        else { return }
        encoder.setRenderPipelineState(blitPipeline)
        encoder.setVertexBuffer(quadCorners, offset: 0, index: 0)
        var scale = SIMD2<Float>(1, 1)
        var offset = SIMD2<Float>(0, 0)
        encoder.setFragmentBytes(&scale, length: MemoryLayout<SIMD2<Float>>.size, index: 0)
        encoder.setFragmentBytes(&offset, length: MemoryLayout<SIMD2<Float>>.size, index: 1)
        encoder.setFragmentTexture(source, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()
    }

    private func blur(from source: MTLTexture, to destination: MTLTexture,
                      direction: SIMD2<Float>, commandBuffer: MTLCommandBuffer) {
        guard let pass = offscreenPass(destination),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass)
        else { return }
        encoder.setRenderPipelineState(blurPipeline)
        encoder.setVertexBuffer(quadCorners, offset: 0, index: 0)
        var dir = direction
        encoder.setFragmentBytes(&dir, length: MemoryLayout<SIMD2<Float>>.size, index: 0)
        encoder.setFragmentTexture(source, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()
    }

    private func clear(_ texture: MTLTexture, commandBuffer: MTLCommandBuffer) {
        guard let pass = offscreenPass(texture),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass)
        else { return }
        encoder.endEncoding()
    }

    // MARK: - Targets

    private func ensureTargets(size: SIMD2<Float>) {
        guard size != cachedSize else { return }

        func makeTexture() -> MTLTexture? {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: Self.pixelFormat,
                width: Int(size.x),
                height: Int(size.y),
                mipmapped: false
            )
            descriptor.usage = [.renderTarget, .shaderRead]
            descriptor.storageMode = .private
            return device.makeTexture(descriptor: descriptor)
        }

        bgTexture = makeTexture()
        blurTextureA = makeTexture()
        blurTextureB = makeTexture()
        cachedSize = size
    }

    /// Uploads a CGImage as the backdrop.
    ///
    /// The image arrives top-row-first, but the shader samples with `v = 1 - y`
    /// (GLSL's `v_screenUV`) and a Metal texture's row 0 is `v = 0` — so the rows
    /// are written in reverse, putting the image's top at `v = 1`. This is the
    /// same flip WebGL performs with `UNPACK_FLIP_Y_WEBGL`; getting it wrong
    /// renders the backdrop upside down inside the glass.
    ///
    /// The pixels go through a staging buffer rather than `replace(region:)`
    /// because the texture is `.private` (CPU-inaccessible), which is what keeps
    /// it cheap on the Intel GPU this app targets. Staging buffers work on both
    /// Intel and Apple Silicon, unlike `.managed`/`.shared` textures, which
    /// differ per architecture.
    private func upload(_ image: CGImage, into texture: MTLTexture,
                        commandBuffer: MTLCommandBuffer) {
        let width = texture.width
        let height = texture.height
        guard width > 0, height > 0 else { return }

        let rowBytes = width * 4
        let byteCount = rowBytes * height

        // Reuse the staging buffer across frames; a panel-sized allocation per
        // redraw would churn memory on every scroll.
        if stagingBuffer == nil || stagingBuffer!.length < byteCount {
            stagingBuffer = device.makeBuffer(length: byteCount, options: .storageModeShared)
        }
        guard let staging = stagingBuffer, let base = staging.contents().baseAddress else {
            return
        }

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue
            | CGBitmapInfo.byteOrder32Little.rawValue

        // Draw with a vertical flip so the buffer's first row is the image's
        // bottom row, matching the texture's v = 0.
        guard let context = CGContext(
            data: base,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: rowBytes,
            space: colorSpace,
            bitmapInfo: bitmapInfo
        ) else { return }
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

        guard let blit = commandBuffer.makeBlitCommandEncoder() else { return }
        blit.copy(
            from: staging,
            sourceOffset: 0,
            sourceBytesPerRow: rowBytes,
            sourceBytesPerImage: byteCount,
            sourceSize: MTLSize(width: width, height: height, depth: 1),
            to: texture,
            destinationSlice: 0,
            destinationLevel: 0,
            destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
        )
        blit.endEncoding()
    }
}
