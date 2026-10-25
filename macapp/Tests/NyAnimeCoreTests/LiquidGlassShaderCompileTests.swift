import XCTest
@testable import NyAnimeCore

/// Compiles the Metal shader source on a real device.
///
/// Metal only exists on macOS, so this is skipped elsewhere — but it runs on
/// the `mac` CI job, where it is the difference between a shader syntax error
/// failing the build and it surfacing as a blank window at launch. It also
/// checks that every function the renderer looks up by name is present, since
/// a typo there would otherwise only appear at runtime.
final class LiquidGlassShaderCompileTests: XCTestCase {

    func testShaderSourceCompilesAndExposesEveryEntryPoint() throws {
        #if os(macOS)
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw XCTSkip("no Metal device on this machine")
        }

        let library: MTLLibrary
        do {
            library = try device.makeLibrary(
                source: LiquidGlassShaderSource.metal, options: nil
            )
        } catch {
            XCTFail("Metal shader failed to compile: \(error)")
            return
        }

        // The renderer builds pipelines from these by name.
        let expected = [
            "glass_quad_vertex",
            "glass_panel_vertex",
            "glass_blit_fragment",
            "glass_blur_fragment",
            "glass_fragment",
        ]
        for name in expected {
            XCTAssertNotNil(
                library.makeFunction(name: name),
                "shader is missing entry point \(name)"
            )
        }

        // Compiling the pipelines is what actually catches a mismatch between
        // the vertex output struct and the fragment input struct.
        let quadDesc = MTLRenderPipelineDescriptor()
        quadDesc.vertexFunction = library.makeFunction(name: "glass_quad_vertex")
        quadDesc.fragmentFunction = library.makeFunction(name: "glass_blur_fragment")
        quadDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        XCTAssertNoThrow(
            try device.makeRenderPipelineState(descriptor: quadDesc),
            "blur pipeline should link"
        )

        let glassDesc = MTLRenderPipelineDescriptor()
        glassDesc.vertexFunction = library.makeFunction(name: "glass_panel_vertex")
        glassDesc.fragmentFunction = library.makeFunction(name: "glass_fragment")
        glassDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        // The glass pass composites over the backdrop, so it needs blending.
        glassDesc.colorAttachments[0].isBlendingEnabled = true
        glassDesc.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        glassDesc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        XCTAssertNoThrow(
            try device.makeRenderPipelineState(descriptor: glassDesc),
            "glass pipeline should link"
        )
        #else
        throw XCTSkip("Metal is macOS-only")
        #endif
    }

    /// The shader source must contain the effect's defining operations. A
    /// refactor that silently dropped the refraction, say, would still compile.
    func testShaderSourceKeepsTheCoreOperations() {
        let src = LiquidGlassShaderSource.metal
        for fragment in [
            "rr_sdf",            // rounded-rect distance field
            "bevel_height",      // bevel profile
            "glass_hash",        // micro-distortion noise
            "refrPx",            // refraction offset
            "caD",               // chromatic aberration
            "1.0 - 1.0 / ior",   // index of refraction
            "smoothstep(-1.5, 0.5, sdf)",   // anti-aliased mask
            "shadowSpread",      // drop shadow
            "totalSpec",         // specular
            "float3(0.92, 0.95, 1.05)",     // cool tint
        ] {
            XCTAssertTrue(
                src.contains(fragment),
                "shader source lost \(fragment)"
            )
        }
    }

    /// The blur weights are duplicated between the shader text and
    /// `LiquidGlassMath`; they must stay identical or the two paths diverge.
    func testShaderBlurWeightsMatchSwiftConstants() {
        let src = LiquidGlassShaderSource.metal
        for weight in LiquidGlassMath.blurWeights {
            let text = String(format: "%.6f", weight)
            XCTAssertTrue(
                src.contains(text),
                "shader blur weights drifted from LiquidGlassMath: missing \(text)"
            )
        }
    }

    /// The MSL `GlassUniforms` and the Swift `LiquidGlassUniforms` must agree
    /// field-for-field and in order.
    ///
    /// MSL packs `float2` to an 8-byte boundary, exactly as Swift does for
    /// `SIMD2<Float>`, so preserving the order is what makes the layouts
    /// compatible. Reordering a field, or changing one's type, would shift every
    /// later value — the panel would still draw, just wrong, which is the kind
    /// of bug that is expensive to find by eye.
    ///
    /// The Swift side is read by reflecting the compiled struct, so this checks
    /// what the renderer actually uploads rather than what the source says.
    func testShaderUniformLayoutMatchesSwiftStruct() throws {
        let msl = LiquidGlassShaderSource.metal
        let structBody = try XCTUnwrap(
            firstCapture(in: msl, pattern: #"struct GlassUniforms \{(.*?)\n\};"#),
            "GlassUniforms struct not found in the shader source"
        )
        let mslFields = matches(
            in: structBody, pattern: #"^\s*(float2|float)\s+(\w+);"#
        ).map { ($0[0] == "float2" ? "float2" : "float", $0[1]) }

        let probe = LiquidGlassUniforms(
            config: LiquidGlassConfig(), size: SIMD2(1, 1), res: SIMD2(1, 1), scale: 1
        )
        let swiftFields = Mirror(reflecting: probe).children.map { child in
            let type = type(of: child.value) == SIMD2<Float>.self ? "float2" : "float"
            return (type, child.label ?? "?")
        }

        XCTAssertEqual(
            mslFields.count, swiftFields.count,
            "uniform field count differs between MSL and Swift"
        )
        XCTAssertEqual(
            mslFields.map { "\($0.0) \($0.1)" },
            swiftFields.map { "\($0.0) \($0.1)" },
            "uniform fields must match in name, type and order"
        )
    }

    /// The Swift struct must be 88 bytes: two `float2` members push the layout
    /// to an 8-byte stride, and the renderer uploads `stride` bytes.
    func testSwiftUniformStructStrideIsPackedAsMetalExpects() {
        XCTAssertEqual(MemoryLayout<LiquidGlassUniforms>.stride, 88)
    }

    /// Point lengths in the config must be converted to device pixels, since
    /// the shader works entirely in pixels.
    func testUniformsConvertPointsToPixels() {
        var config = LiquidGlassConfig()
        config.cornerRadius = 16
        config.zRadius = 40
        config.shadowSpread = 10
        config.shadowOffsetY = 1

        let uniform = LiquidGlassUniforms(
            config: config, size: SIMD2(400, 200), res: SIMD2(440, 240), scale: 2
        )
        XCTAssertEqual(uniform.radius, 32)
        XCTAssertEqual(uniform.zRadius, 80)
        XCTAssertEqual(uniform.shadowSpread, 20)
        XCTAssertEqual(uniform.shadowOffY, 2)
        // Pixel-space values pass through unscaled.
        XCTAssertEqual(uniform.refract, config.refraction)
        XCTAssertEqual(uniform.size, SIMD2(400, 200))
        // `res` is the padded render target, not the panel.
        XCTAssertEqual(uniform.res, SIMD2(440, 240))
    }

    /// The drawable is the panel plus `shadowPad` on every side, and the shader
    /// re-derives the panel by subtracting the padding. If the renderer passed
    /// the whole drawable as the panel, the rounded rect would fill the view and
    /// the shadow would be clipped away.
    func testPaddedPanelGeometryRecoversThePanelSize() {
        // A 200x100 point panel on a 2x display: drawable = (200 + 2*20) * 2.
        let scale: Float = 2
        let padPixels = LiquidGlassMath.shadowPad * scale
        let drawable = SIMD2<Float>(200 * scale + padPixels * 2, 100 * scale + padPixels * 2)
        XCTAssertEqual(drawable, SIMD2(480, 280))

        let panel = SIMD2<Float>(
            drawable.x - padPixels * 2,
            drawable.y - padPixels * 2
        )
        XCTAssertEqual(panel, SIMD2(400, 200), "padding must be removed to recover the panel")
    }

    // MARK: - Regex helpers

    private func firstCapture(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(
            pattern: pattern, options: [.dotMatchesLineSeparators]
        ) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > 1,
              let captured = Range(match.range(at: 1), in: text)
        else { return nil }
        return String(text[captured])
    }

    private func matches(in text: String, pattern: String) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
        else { return [] }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            (1..<match.numberOfRanges).compactMap { index in
                Range(match.range(at: index), in: text).map { String(text[$0]) }
            }
        }
    }
}
