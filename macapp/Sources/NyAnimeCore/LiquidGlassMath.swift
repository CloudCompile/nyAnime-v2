import Foundation

/// The liquid-glass effect as arithmetic.
///
/// A direct port of the fragment-shader maths in `ybouane/liquidglass`
/// (`src/shaders.ts`, `FS_GLASS`). The shader itself lives in
/// `Sources/NyAnime/Glass/GlassShaders.metal`; everything here is the part of
/// it that is pure numbers, extracted so it can be unit-tested without a GPU.
/// The Metal shader and these functions must agree — the tests pin the values,
/// so a shader edit that drifts shows up as a failure.
///
/// Coordinates match the original: `localPx` is measured in pixels from the
/// panel centre and `halfSize` is the panel's half extent, both in the same
/// device-pixel space. `resolution` is the padded render-target size, and the
/// panel is assumed centred in it, as the renderer places it.
///
/// This deliberately avoids the `simd` module (unavailable on Linux) so the
/// target keeps building and testing on a cheap CI runner.
public enum LiquidGlassMath {

    // MARK: - Vector helpers

    static func dot3(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float {
        a.x * b.x + a.y * b.y + a.z * b.z
    }

    static func length2(_ v: SIMD2<Float>) -> Float {
        (v.x * v.x + v.y * v.y).squareRoot()
    }

    static func normalize3(_ v: SIMD3<Float>) -> SIMD3<Float> {
        let len = (v.x * v.x + v.y * v.y + v.z * v.z).squareRoot()
        guard len > 0 else { return SIMD3<Float>(0, 0, 1) }
        return v / len
    }

    static func mix(_ a: Float, _ b: Float, _ t: Float) -> Float {
        a + (b - a) * t
    }

    static func mix(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ t: Float) -> SIMD3<Float> {
        a + (b - a) * t
    }

    static func componentMax(_ a: SIMD2<Float>, _ b: SIMD2<Float>) -> SIMD2<Float> {
        SIMD2<Float>(Swift.max(a.x, b.x), Swift.max(a.y, b.y))
    }

    // MARK: - Geometry

    /// Rounded-rectangle signed distance. Negative inside, positive outside.
    public static func roundedRectSDF(
        _ p: SIMD2<Float>,
        _ b: SIMD2<Float>,
        _ r: Float
    ) -> Float {
        let q = SIMD2<Float>(abs(p.x), abs(p.y)) - b + SIMD2<Float>(repeating: r)
        let outside = SIMD2<Float>(Swift.max(q.x, 0), Swift.max(q.y, 0))
        return Swift.min(Swift.max(q.x, q.y), 0) + length2(outside) - r
    }

    /// Bevel height field across the pill's cross-section.
    ///
    /// `d` is the depth inside the edge (the negated SDF); `zRadius` is the
    /// bevel's z-radius. Both bevel modes share this half-circle profile — a
    /// smooth peak at the centre, a steep fall at the rim — and differ only in
    /// the refraction model applied on top.
    public static func bevelHeight(_ d: Float, _ zRadius: Float) -> Float {
        if d <= 0 { return 0 }
        if d >= zRadius { return zRadius }
        return (d * (2 * zRadius - d)).squareRoot()
    }

    /// GLSL `fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)`.
    ///
    /// Drives the micro-distortion noise. Reproduced exactly rather than
    /// approximated so the Swift and shader paths agree.
    public static func hash(_ p: SIMD2<Float>) -> Float {
        let v = sin(p.x * 127.1 + p.y * 311.7) * 43758.5453
        return v - v.rounded(.down)
    }

    // MARK: - Normals

    /// Top-surface normal from the bevel height field, sampled with the
    /// shader's fixed 2 px offset.
    public static func surfaceNormal(
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        radius: Float,
        zRadius: Float
    ) -> SIMD3<Float> {
        let e: Float = 2
        let dR = -roundedRectSDF(localPx + SIMD2(e, 0), halfSize, radius)
        let dL = -roundedRectSDF(localPx - SIMD2(e, 0), halfSize, radius)
        let dU = -roundedRectSDF(localPx + SIMD2(0, e), halfSize, radius)
        let dD = -roundedRectSDF(localPx - SIMD2(0, e), halfSize, radius)
        let grad = SIMD2<Float>(
            bevelHeight(dR, zRadius) - bevelHeight(dL, zRadius),
            bevelHeight(dU, zRadius) - bevelHeight(dD, zRadius)
        ) / (2 * e)
        return normalize3(SIMD3<Float>(-grad.x, -grad.y, 1))
    }

    /// How far into the bevel a point sits: `smoothstep(0, zRadius, inside)`.
    public static func depthFactor(
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        radius: Float,
        zRadius: Float
    ) -> Float {
        let inside = -roundedRectSDF(localPx, halfSize, radius)
        return smoothstep(0, zRadius, inside)
    }

    /// Edge weight: 1 at the rim, 0 once `maxD * 0.35` inside.
    public static func edgeFactor(
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        radius: Float
    ) -> Float {
        let maxD = Swift.min(halfSize.x, halfSize.y)
        let inside = -roundedRectSDF(localPx, halfSize, radius)
        return smoothstep(maxD * 0.35, 0, inside)
    }

    // MARK: - Refraction

    /// Pixel-space refraction offset for the biconvex (mode 0) pill: light is
    /// bent at the entry and exit surfaces, plus a thickness-weighted term
    /// through the body and a centre-ward pull that grows with depth.
    public static func biconvexRefractionPx(
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        radius: Float,
        zRadius: Float,
        refract: Float
    ) -> SIMD2<Float> {
        let normal = surfaceNormal(
            localPx: localPx, halfSize: halfSize, radius: radius, zRadius: zRadius
        )
        let grad = SIMD2<Float>(-normal.x, -normal.y)
        let ior: Float = 1.5
        let refrPow = 1 - 1 / ior
        let thickness = bevelHeight(-roundedRectSDF(localPx, halfSize, radius), zRadius) * 2
        let thickNorm = thickness / Swift.max(zRadius * 2, 1)
        let exitRefr = grad * refrPow
        let entryRefr = grad * refrPow
        let throughRefr = entryRefr * thickNorm * 0.5
        let depth = depthFactor(
            localPx: localPx, halfSize: halfSize, radius: radius, zRadius: zRadius
        )
        let centerDir = -localPx / componentMax(halfSize, SIMD2(repeating: 1))
        return (exitRefr + entryRefr + throughRefr) * refract * 30
            + centerDir * refract * 4 * depth
    }

    /// Pixel-space refraction offset for the dome (mode 1) plano-convex pill:
    /// a uniform contraction toward the centre, which reads as magnification.
    public static func domeRefractionPx(
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        radius: Float,
        zRadius: Float,
        refract: Float
    ) -> SIMD2<Float> {
        let depth = depthFactor(
            localPx: localPx, halfSize: halfSize, radius: radius, zRadius: zRadius
        )
        return -localPx * refract * depth * 0.35
    }

    // MARK: - Sampling offsets

    /// The shader's `vec2(1, -1) / u_res`: pixels to UV, flipping y because
    /// panel space has its origin top-left while texture space is bottom-up.
    public static func pixelToUV(_ resolution: SIMD2<Float>) -> SIMD2<Float> {
        SIMD2<Float>(1, -1) / resolution
    }

    /// Chromatic-aberration offset in UV space, strongest near the rim.
    public static func chromaOffsetUV(
        normal: SIMD3<Float>,
        edge: Float,
        chroma: Float,
        resolution: SIMD2<Float>
    ) -> SIMD2<Float> {
        let scale = chroma * 18 * (edge * 0.7 + 0.3) * 2
        let dir = SIMD2<Float>(normal.x, normal.y) * scale
        return dir * pixelToUV(resolution)
    }

    /// Micro-distortion noise offset in UV space.
    public static func microDistortionUV(
        localPx: SIMD2<Float>,
        distortion: Float,
        resolution: SIMD2<Float>
    ) -> SIMD2<Float> {
        let ns = localPx * 0.08
        let n = SIMD2<Float>(hash(ns), hash(ns + SIMD2(37, 0))) - SIMD2(repeating: 0.5)
        return n * distortion * 4 * (SIMD2(repeating: 1) / resolution)
    }

    // MARK: - Shading

    /// Edge-weighted mix factor between the sharp and blurred background. The
    /// centre leans on the blur; the rim blends toward sharp so the refracted
    /// edge stays crisp.
    public static func blurMix(edge: Float) -> Float {
        1 - edge * 0.15
    }

    /// Brightness, then saturation, then the cool tint, then the small
    /// depth-driven lift — in the shader's order.
    public static func applyColorAdjustments(
        _ color: SIMD3<Float>,
        saturation: Float,
        tint: Float,
        brightness: Float,
        depth: Float
    ) -> SIMD3<Float> {
        var c = color * (1 + brightness)
        let lum = dot3(c, SIMD3<Float>(0.299, 0.587, 0.114))
        c = mix(SIMD3<Float>(repeating: lum), c, 1 + saturation)
        c = mix(c, c * SIMD3<Float>(0.92, 0.95, 1.05), tint)
        return c * (1 + 0.06 * depth)
    }

    /// Fresnel term: strongest at grazing angles, where the normal turns away
    /// from the viewer.
    public static func fresnel(normalZ: Float, intensity: Float) -> Float {
        pow(1 - abs(normalZ), 4) * intensity
    }

    /// Multi-light Blinn-Phong specular sum.
    public static func specular(normal: SIMD3<Float>, intensity: Float) -> Float {
        let v = SIMD3<Float>(0, 0, 1)
        let l1 = normalize3(SIMD3<Float>(0.4, 0.7, 1))
        let sp1 = pow(Swift.max(dot3(normal, normalize3(l1 + v)), 0), 90)
        let l2 = normalize3(SIMD3<Float>(-0.3, -0.5, 1))
        let sp2 = pow(Swift.max(dot3(normal, normalize3(l2 + v)), 0), 50) * 0.3
        let l3 = normalize3(SIMD3<Float>(0.1, 0.3, 1))
        let spB = pow(Swift.max(dot3(normal, l3), 0), 6) * 0.1
        let l4 = normalize3(SIMD3<Float>(0, 0.9, 0.4))
        let sp4 = pow(Swift.max(dot3(normal, normalize3(l4 + v)), 0), 120) * 0.6
        return (sp1 + sp2 + spB + sp4) * intensity
    }

    /// Anti-aliased panel coverage from the SDF.
    public static func mask(sdf: Float) -> Float {
        1 - smoothstep(-1.5, 0.5, sdf)
    }

    /// Inner 1.5 px stroke, biased brighter along the top edge so the pane
    /// reads as lit from above.
    public static func innerStroke(
        sdf: Float,
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        edgeHighlight: Float
    ) -> Float {
        let borderWidth: Float = 1.5
        var s = smoothstep(-borderWidth - 1, -borderWidth, sdf)
            * (1 - smoothstep(-1, 0, sdf))
        let topBias = 0.5 + 0.5 * (-localPx.y / halfSize.y)
        s *= (0.4 + 0.6 * topBias)
        return s * edgeHighlight * 0.55
    }

    /// Shadow alpha for a point outside the panel: a wide outer falloff plus a
    /// tighter contact shadow, both offset downward.
    public static func shadowAlpha(
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        radius: Float,
        shadowOpacity: Float,
        shadowSpread: Float,
        shadowOffsetY: Float
    ) -> Float {
        let sdfShadow = roundedRectSDF(
            localPx - SIMD2(0, shadowOffsetY), halfSize, radius
        )
        let d = Swift.max(sdfShadow - 1, 0)
        let spread = Swift.max(shadowSpread, 1)
        let falloff = 1 / (spread * spread)
        let outer = exp(-d * d * falloff) * 0.65
        let contact = exp(-d * 0.08 / Swift.max(spread * 0.04, 0.01)) * 0.35
        return (outer + contact) * shadowOpacity
    }

    /// Fake environment reflection: the normal's vertical tilt, scaled by
    /// Fresnel.
    public static func environmentReflection(normalY: Float, fresnel: Float) -> Float {
        (normalY * 0.5 + 0.5) * fresnel * 0.08
    }

    // MARK: - Full shading

    /// Screen UV for a point at `localPx` from the panel centre, with the panel
    /// centred in `resolution` — matching `VS_GLASS`.
    public static func screenUV(
        localPx: SIMD2<Float>,
        resolution: SIMD2<Float>
    ) -> SIMD2<Float> {
        let px = resolution * 0.5 + localPx
        return SIMD2<Float>(px.x / resolution.x, 1 - px.y / resolution.y)
    }

    /// The complete `FS_GLASS` result for one fragment, given a sampler for the
    /// backdrop.
    ///
    /// `sampleSharp` and `sampleBlur` receive a screen UV (already including
    /// the refraction, chromatic-aberration and micro-distortion offsets) and
    /// return the backdrop colour there, as a texture lookup would. With
    /// `blurAmount == 0` the two sources are identical, which is the case the
    /// cross-validation harness exercises.
    ///
    /// Returns RGBA in 0...1 with alpha already multiplied in, as the shader
    /// writes it.
    public static func shade(
        localPx: SIMD2<Float>,
        halfSize: SIMD2<Float>,
        resolution: SIMD2<Float>,
        config: LiquidGlassConfig,
        sampleSharp: (SIMD2<Float>) -> SIMD3<Float>,
        sampleBlur: (SIMD2<Float>) -> SIMD3<Float>
    ) -> SIMD4<Float> {
        let radius = Swift.min(config.cornerRadius, Swift.min(halfSize.x, halfSize.y))
        let sdf = roundedRectSDF(localPx, halfSize, radius)

        // Outside the panel: only the drop shadow.
        if sdf > 0 {
            let shadow = shadowAlpha(
                localPx: localPx,
                halfSize: halfSize,
                radius: radius,
                shadowOpacity: config.shadowOpacity,
                shadowSpread: config.shadowSpread,
                shadowOffsetY: config.shadowOffsetY
            )
            return SIMD4<Float>(0, 0, 0, shadow)
        }

        let maskValue = mask(sdf: sdf)
        let edge = edgeFactor(localPx: localPx, halfSize: halfSize, radius: radius)
        let normal = surfaceNormal(
            localPx: localPx, halfSize: halfSize, radius: radius, zRadius: config.zRadius
        )
        let depth = depthFactor(
            localPx: localPx, halfSize: halfSize, radius: radius, zRadius: config.zRadius
        )

        let refrPx: SIMD2<Float> = config.bevelMode == 0
            ? biconvexRefractionPx(
                localPx: localPx, halfSize: halfSize, radius: radius,
                zRadius: config.zRadius, refract: config.refraction
            )
            : domeRefractionPx(
                localPx: localPx, halfSize: halfSize, radius: radius,
                zRadius: config.zRadius, refract: config.refraction
            )

        let base = screenUV(localPx: localPx, resolution: resolution)
            + refrPx * pixelToUV(resolution)
            + microDistortionUV(
                localPx: localPx,
                distortion: config.distortion,
                resolution: resolution
            )

        let caD = chromaOffsetUV(
            normal: normal,
            edge: edge,
            chroma: config.chromAberration,
            resolution: resolution
        )

        let sharp = SIMD3<Float>(
            sampleSharp(base + caD).x,
            sampleSharp(base).y,
            sampleSharp(base - caD).z
        )
        let blur = SIMD3<Float>(
            sampleBlur(base + caD).x,
            sampleBlur(base).y,
            sampleBlur(base - caD).z
        )

        var col = mix(sharp, blur, blurMix(edge: edge))
        col = applyColorAdjustments(
            col,
            saturation: config.saturation,
            tint: config.tintStrength,
            brightness: config.brightness,
            depth: depth
        )

        let fres = fresnel(normalZ: normal.z, intensity: config.fresnel)
        let spec = specular(normal: normal, intensity: config.specular)
        let rim = edge * config.edgeHighlight * 0.22
        let innerGlow = smoothstep(5, 0, -sdf) * config.edgeHighlight * 0.15
        let stroke = innerStroke(
            sdf: sdf, localPx: localPx, halfSize: halfSize,
            edgeHighlight: config.edgeHighlight
        )
        let envRefl = environmentReflection(normalY: normal.y, fresnel: fres)

        var fin = col + SIMD3<Float>(repeating: spec + rim + innerGlow + stroke + envRefl)
        fin = mix(fin, SIMD3<Float>(repeating: 1), fres * 0.2)

        return SIMD4<Float>(fin.x, fin.y, fin.z, maskValue * config.opacity)
    }

    // MARK: - Constants

    /// The 9-tap Gaussian weights, in tap order 0, ±1, ±2, ±3, ±4.
    ///
    /// The shader hard-codes these; the renderer reads them from here so the
    /// Swift and MSL paths cannot drift.
    public static let blurWeights: [Float] = [
        0.227027,
        0.194594, 0.194594,
        0.121622, 0.121622,
        0.054054, 0.054054,
        0.016216, 0.016216,
    ]

    /// Gaussian blur passes per direction (the original's `BLUR_ITERATIONS`).
    public static let blurIterations = 6

    /// Extra padding around each panel, in CSS pixels, to make room for the
    /// drop shadow (the original's `SHADOW_PAD`).
    public static let shadowPad: Float = 20

    // MARK: - Helpers

    /// GLSL `smoothstep`. The clamped-lerp form matches the shader exactly at
    /// the endpoints, which the shader relies on for its masks.
    public static func smoothstep(_ edge0: Float, _ edge1: Float, _ x: Float) -> Float {
        let t = Swift.min(Swift.max((x - edge0) / (edge1 - edge0), 0), 1)
        return t * t * (3 - 2 * t)
    }
}

/// Per-panel configuration, mirroring the original's `GlassConfig` and its
/// documented defaults.
public struct LiquidGlassConfig: Sendable, Equatable {
    /// Background blur strength, 0 (sharp) to 1 (maximum).
    public var blurAmount: Float = 0
    /// How strongly the glass bends what is behind it.
    public var refraction: Float = 0.69
    /// Colour fringing at the edges.
    public var chromAberration: Float = 0.05
    /// Rim lighting intensity.
    public var edgeHighlight: Float = 0.05
    /// Specular highlight intensity.
    public var specular: Float = 0
    /// Fresnel reflection at grazing angles.
    public var fresnel: Float = 1
    /// Micro-distortion noise strength.
    public var distortion: Float = 0
    /// Corner radius in CSS pixels.
    public var cornerRadius: Float = 65
    /// Bevel depth — the curvature of the pill's cross-section.
    public var zRadius: Float = 40
    /// Overall panel opacity.
    public var opacity: Float = 1
    /// Saturation adjustment, -1 (grey) to 1 (vivid).
    public var saturation: Float = 0
    /// Cool blue tint strength.
    public var tintStrength: Float = 0
    /// Brightness adjustment.
    public var brightness: Float = 0
    /// Drop-shadow opacity.
    public var shadowOpacity: Float = 0.30
    /// Drop-shadow spread in CSS pixels.
    public var shadowSpread: Float = 10
    /// Drop-shadow vertical offset in CSS pixels.
    public var shadowOffsetY: Float = 1
    /// 0 = biconvex pill, 1 = dome.
    public var bevelMode: Int = 0

    public init() {}
}

/// Mirrors `GlassUniforms` in `LiquidGlassShaderSource.metal`.
///
/// Field order and types must match the MSL struct exactly. MSL packs `float2`
/// to an 8-byte boundary just as Swift does for `SIMD2<Float>`, so the two
/// layouts agree as long as the order is preserved. Reordering a field would
/// shift every later value: the panel would still draw, just wrong. It lives in
/// this platform-agnostic target so the layout can be asserted on any machine.
public struct LiquidGlassUniforms: Sendable, Equatable {
    public var size: SIMD2<Float>
    public var radius: Float
    public var res: SIMD2<Float>
    public var refract: Float
    public var chroma: Float
    public var edgeHL: Float
    public var spec: Float
    public var fresnel: Float
    public var distort: Float
    public var alpha: Float
    public var sat: Float
    public var tint: Float
    public var zRadius: Float
    public var brightness: Float
    public var shadowAlpha: Float
    public var shadowSpread: Float
    public var shadowOffY: Float
    public var bevelMode: Float

    public init(
        size: SIMD2<Float>,
        radius: Float,
        res: SIMD2<Float>,
        refract: Float,
        chroma: Float,
        edgeHL: Float,
        spec: Float,
        fresnel: Float,
        distort: Float,
        alpha: Float,
        sat: Float,
        tint: Float,
        zRadius: Float,
        brightness: Float,
        shadowAlpha: Float,
        shadowSpread: Float,
        shadowOffY: Float,
        bevelMode: Float
    ) {
        self.size = size
        self.radius = radius
        self.res = res
        self.refract = refract
        self.chroma = chroma
        self.edgeHL = edgeHL
        self.spec = spec
        self.fresnel = fresnel
        self.distort = distort
        self.alpha = alpha
        self.sat = sat
        self.tint = tint
        self.zRadius = zRadius
        self.brightness = brightness
        self.shadowAlpha = shadowAlpha
        self.shadowSpread = shadowSpread
        self.shadowOffY = shadowOffY
        self.bevelMode = bevelMode
    }

    /// Builds the uniform block for a panel of `size` device pixels rendered
    /// into a `res`-sized target.
    ///
    /// `size` is the panel itself (the rounded rect); `res` is the padded
    /// render target the shader converts pixel offsets against, which is what
    /// the vertex stage used for `screenUV`. Lengths in `config` are in points,
    /// so `scale` (the backing scale factor) converts them to device pixels —
    /// the shader works entirely in pixels.
    public init(
        config: LiquidGlassConfig,
        size: SIMD2<Float>,
        res: SIMD2<Float>,
        scale: Float
    ) {
        self.init(
            size: size,
            radius: config.cornerRadius * scale,
            res: res,
            refract: config.refraction,
            chroma: config.chromAberration,
            edgeHL: config.edgeHighlight,
            spec: config.specular,
            fresnel: config.fresnel,
            distort: config.distortion,
            alpha: config.opacity,
            sat: config.saturation,
            tint: config.tintStrength,
            zRadius: config.zRadius * scale,
            brightness: config.brightness,
            shadowAlpha: config.shadowOpacity,
            shadowSpread: config.shadowSpread * scale,
            shadowOffY: config.shadowOffsetY * scale,
            bevelMode: Float(config.bevelMode)
        )
    }
}
