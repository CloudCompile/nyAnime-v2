import SwiftUI
import MetalKit
import NyAnimeCore

/// A SwiftUI view that renders the liquid-glass effect behind its content.
///
/// Drop it in as a background or overlay:
///
/// ```swift
/// Text("Panel")
///     .padding()
///     .background(LiquidGlassSurface(cornerRadius: 16))
/// ```
///
/// The glass samples the window content *behind* it, so whatever the panel sits
/// over is what gets refracted — the same contract as the web library, where
/// the shader samples the root's other children.
///
/// Redraws are driven by `enableSetNeedsDisplay`: the view is marked dirty when
/// it first appears, when it resizes, and when an ancestor scroll view scrolls.
/// An idle window costs no GPU work and no timers, which is what keeps idle RAM
/// flat on the Intel machine this app targets.
struct LiquidGlassSurface: NSViewRepresentable {
    /// Corner radius in points, matching the SwiftUI shape it backs.
    var cornerRadius: CGFloat = 16
    /// Per-panel tuning; defaults match the upstream library.
    var config: LiquidGlassConfig = LiquidGlassConfig()

    /// The shadow is drawn in a padded border around the panel, so the Metal
    /// view extends this far past the panel on every side.
    private static let shadowPad = CGFloat(LiquidGlassMath.shadowPad)

    func makeCoordinator() -> Coordinator {
        Coordinator(config: config, cornerRadius: cornerRadius)
    }

    func makeNSView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        view.delegate = context.coordinator
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        // `NSView.isOpaque` is get-only in Swift; the layer is what matters for
        // a transparent backing store.
        view.layer?.isOpaque = false
        // No continuous rendering: draw only when something changed.
        view.isPaused = true
        view.enableSetNeedsDisplay = true
        view.autoResizeDrawable = true
        context.coordinator.attach(to: view)
        return view
    }

    func updateNSView(_ view: MTKView, context: Context) {
        context.coordinator.update(config: config, cornerRadius: cornerRadius)
        context.coordinator.setNeedsDisplay()
    }

    /// Bridges AppKit to the renderer and owns the redraw triggers.
    final class Coordinator: NSObject, MTKViewDelegate {
        private var config: LiquidGlassConfig
        private var cornerRadius: CGFloat

        private weak var view: MTKView?
        private var renderer: LiquidGlassRenderer?
        private var scrollObserver: NSObjectProtocol?

        init(config: LiquidGlassConfig, cornerRadius: CGFloat) {
            self.config = config
            self.cornerRadius = cornerRadius
            super.init()
            applyShape()
        }

        /// The view's `cornerRadius` is the source of truth for the shape, so it
        /// wins over whatever the caller left in the config.
        private func applyShape() {
            config.cornerRadius = Float(cornerRadius)
        }

        /// Applies new SwiftUI inputs.
        func update(config: LiquidGlassConfig, cornerRadius: CGFloat) {
            self.config = config
            self.cornerRadius = cornerRadius
            applyShape()
        }

        deinit {
            if let scrollObserver {
                NotificationCenter.default.removeObserver(scrollObserver)
            }
        }

        func attach(to view: MTKView) {
            self.view = view
            if let device = view.device {
                renderer = LiquidGlassRenderer(device: device)
            }
        }

        /// Flags the view for a redraw on the next run-loop pass.
        func setNeedsDisplay() {
            view?.setNeedsDisplay(view?.bounds ?? .zero)
        }

        // MARK: - MTKViewDelegate

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
            setNeedsDisplay()
            observeEnclosingScrollView()
        }

        func draw(in view: MTKView) {
            guard let renderer else { return }
            // The renderer derives the backing scale and converts point lengths
            // to device pixels, so the config is passed through untouched.
            renderer.draw(in: view, backdrop: captureBackdrop(of: view), config: config)
        }

        // MARK: - Backdrop capture

        /// Rasterises the window content behind this view, cropped to the view's
        /// own area (which already includes the shadow padding).
        ///
        /// The glass view is hidden for the duration so it cannot capture itself
        /// and feed its own output back in.
        private func captureBackdrop(of view: MTKView) -> CGImage? {
            guard let window = view.window,
                  let contentView = window.contentView
            else { return nil }

            // The view's rect expressed in the content view's coordinates.
            let rectInWindow = view.convert(view.bounds, to: nil)
            let rectInContent = contentView.convert(rectInWindow, from: nil)

            guard rectInContent.width >= 1, rectInContent.height >= 1 else { return nil }

            let wasHidden = view.isHidden
            view.isHidden = true
            defer { view.isHidden = wasHidden }

            guard let rep = contentView.bitmapImageRepForCachingDisplay(in: rectInContent)
            else { return nil }
            contentView.cacheDisplay(in: rectInContent, to: rep)
            return rep.cgImage
        }

        // MARK: - Redraw triggers

        /// Re-captures while an ancestor scroll view moves, so the refracted
        /// content tracks the scroll instead of freezing at its old position.
        private func observeEnclosingScrollView() {
            guard scrollObserver == nil, let view else { return }

            var ancestor: NSView? = view.superview
            while let current = ancestor {
                if let scrollView = current as? NSScrollView {
                    let clipView = scrollView.contentView
                    clipView.postsBoundsChangedNotifications = true
                    scrollObserver = NotificationCenter.default.addObserver(
                        forName: NSView.boundsDidChangeNotification,
                        object: clipView,
                        queue: .main
                    ) { [weak self] _ in
                        self?.setNeedsDisplay()
                    }
                    return
                }
                ancestor = current.superview
            }
        }
    }
}

/// Places a `LiquidGlassSurface` behind `content`, sized to include the shadow
/// padding the shader needs.
///
/// The Metal view is deliberately larger than the panel and centred on it, so
/// the drop shadow has room to fade out. SwiftUI draws the overflow unless an
/// ancestor clips it — the same constraint the web library documents.
public struct LiquidGlassBackground<Content: View>: View {
    private let cornerRadius: CGFloat
    private let config: LiquidGlassConfig
    private let content: Content

    public init(
        cornerRadius: CGFloat = 16,
        config: LiquidGlassConfig = LiquidGlassConfig(),
        @ViewBuilder content: () -> Content
    ) {
        self.cornerRadius = cornerRadius
        self.config = config
        self.content = content()
    }

    public var body: some View {
        content
            .background {
                GeometryReader { geometry in
                    let pad = CGFloat(LiquidGlassMath.shadowPad)
                    LiquidGlassSurface(cornerRadius: cornerRadius, config: config)
                        .frame(
                            width: geometry.size.width + pad * 2,
                            height: geometry.size.height + pad * 2
                        )
                        .position(
                            x: geometry.size.width / 2,
                            y: geometry.size.height / 2
                        )
                }
            }
    }
}
