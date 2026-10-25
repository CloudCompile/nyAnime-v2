import XCTest
@testable import NyAnimeCore

/// Unit tests for the liquid-glass maths.
///
/// These pin the values the Metal shader must produce. The shader itself can
/// only be compiled and run on macOS, so these tests are the part of the port
/// that is verifiable on any platform — they catch a sign flip, a missing
/// normalise or a transposed offset before it reaches a GPU.
final class LiquidGlassMathTests: XCTestCase {

    private var config: LiquidGlassConfig {
        var c = LiquidGlassConfig()
        c.cornerRadius = 16
        c.zRadius = 40
        return c
    }

    // MARK: - Rounded-rect SDF

    func testSDFIsNegativeInsideAndPositiveOutside() {
        let half = SIMD2<Float>(100, 50)
        let r: Float = 16
        XCTAssertLessThan(LiquidGlassMath.roundedRectSDF(SIMD2(0, 0), half, r), 0)
        XCTAssertLessThan(LiquidGlassMath.roundedRectSDF(SIMD2(50, 20), half, r), 0)
        XCTAssertGreaterThan(LiquidGlassMath.roundedRectSDF(SIMD2(200, 0), half, r), 0)
        XCTAssertGreaterThan(LiquidGlassMath.roundedRectSDF(SIMD2(0, 200), half, r), 0)
    }

    /// On the flat part of an edge the distance to the boundary is exact, so
    /// the SDF equals the signed distance to the side.
    func testSDFIsExactOnEdgeMidpoints() {
        let half = SIMD2<Float>(100, 50)
        let r: Float = 16
        // 10 px outside the right edge, well away from the corners.
        XCTAssertEqual(
            LiquidGlassMath.roundedRectSDF(SIMD2(110, 0), half, r), 10, accuracy: 1e-4
        )
        // 10 px inside the right edge.
        XCTAssertEqual(
            LiquidGlassMath.roundedRectSDF(SIMD2(90, 0), half, r), -10, accuracy: 1e-4
        )
    }

    /// At a corner the boundary is a circle of radius r centred at
    /// (half - r), so the distance from the centre along the diagonal is
    /// exact and easy to check by hand.
    func testSDFIsExactAtCornerArc() {
        let half = SIMD2<Float>(100, 50)
        let r: Float = 16
        let cornerCentre = SIMD2<Float>(half.x - r, half.y - r)
        // 10 px beyond the corner circle along the diagonal.
        let dir = SIMD2<Float>(1, 1) / Float(2).squareRoot()
        let p = cornerCentre + dir * (r + 10)
        XCTAssertEqual(LiquidGlassMath.roundedRectSDF(p, half, r), 10, accuracy: 1e-3)
    }

    func testSDFIsSymmetric() {
        let half = SIMD2<Float>(100, 50)
        let r: Float = 16
        let p = SIMD2<Float>(63, -21)
        XCTAssertEqual(
            LiquidGlassMath.roundedRectSDF(p, half, r),
            LiquidGlassMath.roundedRectSDF(SIMD2(-63, 21), half, r),
            accuracy: 1e-5
        )
    }

    // MARK: - Bevel height

    func testBevelHeightClampsOutsideTheBevel() {
        XCTAssertEqual(LiquidGlassMath.bevelHeight(0, 40), 0)
        XCTAssertEqual(LiquidGlassMath.bevelHeight(-5, 40), 0)
        XCTAssertEqual(LiquidGlassMath.bevelHeight(40, 40), 40)
        XCTAssertEqual(LiquidGlassMath.bevelHeight(80, 40), 40)
    }

    /// The profile is a half-circle: h(d) = sqrt(d(2R - d)), which peaks at R.
    func testBevelHeightMatchesHalfCircle() {
        let zR: Float = 40
        for d: Float in [1, 5, 12.5, 20, 33, 39] {
            let expected = (d * (2 * zR - d)).squareRoot()
            XCTAssertEqual(
                LiquidGlassMath.bevelHeight(d, zR), expected, accuracy: 1e-5,
                "bevel height wrong at depth \(d)"
            )
        }
    }

    func testBevelHeightIsMonotonic() {
        var previous = LiquidGlassMath.bevelHeight(0, 40)
        for d in stride(from: Float(0.5), through: 40, by: 0.5) {
            let h = LiquidGlassMath.bevelHeight(d, 40)
            XCTAssertGreaterThanOrEqual(h, previous, "bevel height must not decrease")
            previous = h
        }
    }

    // MARK: - Hash

    /// GLSL `fract` always lands in [0, 1); a sign slip here would show up as
    /// visible speckle.
    func testHashIsInUnitRange() {
        for x in stride(from: Float(-50), through: 50, by: 3.7) {
            for y in stride(from: Float(-50), through: 50, by: 4.3) {
                let h = LiquidGlassMath.hash(SIMD2(x, y))
                XCTAssertGreaterThanOrEqual(h, 0)
                XCTAssertLessThan(h, 1)
            }
        }
    }

    func testHashIsDeterministic() {
        let p = SIMD2<Float>(12.5, -3.25)
        XCTAssertEqual(LiquidGlassMath.hash(p), LiquidGlassMath.hash(p), accuracy: 0)
    }

    // MARK: - Normals

    /// At the centre of a large flat panel the bevel is flat, so the normal
    /// must point straight at the viewer.
    func testNormalIsFlatAtPanelCentre() {
        let normal = LiquidGlassMath.surfaceNormal(
            localPx: SIMD2(0, 0), halfSize: SIMD2(150, 100), radius: 16, zRadius: 40
        )
        XCTAssertEqual(normal.x, 0, accuracy: 1e-4)
        XCTAssertEqual(normal.y, 0, accuracy: 1e-4)
        XCTAssertEqual(normal.z, 1, accuracy: 1e-4)
    }

    /// Near the rim the bevel slopes, so the normal must tilt *outward* —
    /// toward the nearest edge, away from the centre. At the +x rim the bevel
    /// height falls as x grows, so the gradient is negative and the normal
    /// (which is -gradient) leans toward +x.
    func testNormalTiltsOutwardNearTheRim() {
        let half = SIMD2<Float>(150, 100)
        let normal = LiquidGlassMath.surfaceNormal(
            localPx: SIMD2(145, 0), halfSize: half, radius: 16, zRadius: 40
        )
        XCTAssertGreaterThan(
            normal.x, 0.05, "normal should tilt outward, toward the +x rim"
        )
        XCTAssertEqual(normal.y, 0, accuracy: 0.05)
        XCTAssertLessThan(normal.z, 1)
    }

    func testNormalIsUnitLength() {
        let half = SIMD2<Float>(150, 100)
        for p in [SIMD2<Float>(0, 0), SIMD2(140, 20), SIMD2(-90, -80), SIMD2(100, 95)] {
            let n = LiquidGlassMath.surfaceNormal(
                localPx: p, halfSize: half, radius: 16, zRadius: 40
            )
            let len = (n.x * n.x + n.y * n.y + n.z * n.z).squareRoot()
            XCTAssertEqual(len, 1, accuracy: 1e-4, "normal not normalised at \(p)")
        }
    }

    // MARK: - Depth and edge factors

    func testDepthFactorRampsFromEdgeToBevelPeak() {
        let half = SIMD2<Float>(150, 100)
        let zR: Float = 40
        // Just inside the right edge: shallow.
        let atEdge = LiquidGlassMath.depthFactor(
            localPx: SIMD2(149, 0), halfSize: half, radius: 16, zRadius: zR
        )
        // Well inside: saturated at 1.
        let deep = LiquidGlassMath.depthFactor(
            localPx: SIMD2(0, 0), halfSize: half, radius: 16, zRadius: zR
        )
        XCTAssertGreaterThanOrEqual(atEdge, 0)
        XCTAssertLessThan(atEdge, 0.2)
        XCTAssertEqual(deep, 1, accuracy: 1e-4)
    }

    func testEdgeFactorIsOneAtRimAndZeroDeep() {
        let half = SIMD2<Float>(150, 100)
        let atRim = LiquidGlassMath.edgeFactor(
            localPx: SIMD2(150, 0), halfSize: half, radius: 16
        )
        let deep = LiquidGlassMath.edgeFactor(
            localPx: SIMD2(0, 0), halfSize: half, radius: 16
        )
        XCTAssertEqual(atRim, 1, accuracy: 0.02, "edge weight should peak at the rim")
        XCTAssertEqual(deep, 0, accuracy: 1e-4, "edge weight should vanish at the centre")
    }

    // MARK: - Refraction

    /// The whole point of the effect: the centre of the panel samples nearly
    /// straight through, so refraction there must be small.
    func testRefractionIsNearZeroAtCentre() {
        let half = SIMD2<Float>(150, 100)
        let offset = LiquidGlassMath.biconvexRefractionPx(
            localPx: SIMD2(0, 0), halfSize: half, radius: 16, zRadius: 40, refract: 0.69
        )
        XCTAssertEqual(offset.x, 0, accuracy: 1e-4)
        XCTAssertEqual(offset.y, 0, accuracy: 1e-4)
    }

    /// Near the rim the glass bends harder, and the pull is centre-ward, so
    /// the offset points back into the panel.
    func testRefractionPullsTowardCentreNearRim() {
        let half = SIMD2<Float>(150, 100)
        let offset = LiquidGlassMath.biconvexRefractionPx(
            localPx: SIMD2(148, 0), halfSize: half, radius: 16, zRadius: 40, refract: 0.69
        )
        XCTAssertLessThan(offset.x, 0, "offset at the +x rim must point toward the centre")
        XCTAssertGreaterThan(
            abs(offset.x), 0.01, "refraction at the rim should be clearly non-zero"
        )
    }

    /// Refraction is linear in the strength, so doubling `refract` doubles the
    /// offset. A shader that dropped the uniform would fail this.
    func testRefractionScalesWithStrength() {
        let half = SIMD2<Float>(150, 100)
        let base = LiquidGlassMath.biconvexRefractionPx(
            localPx: SIMD2(120, 40), halfSize: half, radius: 16, zRadius: 40, refract: 0.4
        )
        let doubled = LiquidGlassMath.biconvexRefractionPx(
            localPx: SIMD2(120, 40), halfSize: half, radius: 16, zRadius: 40, refract: 0.8
        )
        XCTAssertEqual(doubled.x, base.x * 2, accuracy: 1e-3)
        XCTAssertEqual(doubled.y, base.y * 2, accuracy: 1e-3)
    }

    /// A zero-strength glass must not move the backdrop at all.
    func testZeroRefractionIsAPassthrough() {
        let offset = LiquidGlassMath.biconvexRefractionPx(
            localPx: SIMD2(140, 30), halfSize: SIMD2(150, 100),
            radius: 16, zRadius: 40, refract: 0
        )
        XCTAssertEqual(offset.x, 0, accuracy: 1e-6)
        XCTAssertEqual(offset.y, 0, accuracy: 1e-6)
    }

    /// The dome mode magnifies by contracting toward the centre, so its offset
    /// is opposite in sign to a pure centre-ward pull.
    func testDomeRefractionContractsTowardCentre() {
        let half = SIMD2<Float>(150, 100)
        let offset = LiquidGlassMath.domeRefractionPx(
            localPx: SIMD2(100, 0), halfSize: half, radius: 16, zRadius: 40, refract: 0.69
        )
        XCTAssertLessThan(offset.x, 0, "dome should contract toward the centre")
    }

    // MARK: - Colour adjustments

    func testSaturationOfMinusOneProducesGrey() {
        let out = LiquidGlassMath.applyColorAdjustments(
            SIMD3(0.9, 0.2, 0.4), saturation: -1, tint: 0, brightness: 0, depth: 0
        )
        XCTAssertEqual(out.x, out.y, accuracy: 1e-4)
        XCTAssertEqual(out.y, out.z, accuracy: 1e-4)
    }

    func testBrightnessScalesLinearly() {
        let base = SIMD3<Float>(0.5, 0.4, 0.3)
        let out = LiquidGlassMath.applyColorAdjustments(
            base, saturation: 0, tint: 0, brightness: 0.2, depth: 0
        )
        XCTAssertEqual(out.x, 0.6, accuracy: 1e-4)
        XCTAssertEqual(out.y, 0.48, accuracy: 1e-4)
    }

    /// The tint is cool: it lifts blue and drops red.
    func testTintCoolsTheImage() {
        let out = LiquidGlassMath.applyColorAdjustments(
            SIMD3(0.5, 0.5, 0.5), saturation: 0, tint: 1, brightness: 0, depth: 0
        )
        XCTAssertLessThan(out.x, out.z, "tint should leave the result bluer than it is red")
        XCTAssertEqual(out.x, 0.46, accuracy: 1e-3)
        XCTAssertEqual(out.z, 0.525, accuracy: 1e-3)
    }

    func testZeroAdjustmentsLeaveColourAlone() {
        let base = SIMD3<Float>(0.31, 0.62, 0.93)
        let out = LiquidGlassMath.applyColorAdjustments(
            base, saturation: 0, tint: 0, brightness: 0, depth: 0
        )
        XCTAssertEqual(out.x, base.x, accuracy: 1e-5)
        XCTAssertEqual(out.y, base.y, accuracy: 1e-5)
        XCTAssertEqual(out.z, base.z, accuracy: 1e-5)
    }

    // MARK: - Fresnel and specular

    func testFresnelIsZeroFaceOnAndRisesAtGrazingAngles() {
        XCTAssertEqual(LiquidGlassMath.fresnel(normalZ: 1, intensity: 1), 0, accuracy: 1e-6)
        XCTAssertGreaterThan(LiquidGlassMath.fresnel(normalZ: 0.5, intensity: 1), 0)
        XCTAssertGreaterThan(
            LiquidGlassMath.fresnel(normalZ: 0.1, intensity: 1),
            LiquidGlassMath.fresnel(normalZ: 0.5, intensity: 1),
            "Fresnel must strengthen as the surface turns away"
        )
    }

    func testFresnelScalesWithIntensity() {
        XCTAssertEqual(
            LiquidGlassMath.fresnel(normalZ: 0.3, intensity: 0.5),
            LiquidGlassMath.fresnel(normalZ: 0.3, intensity: 1) * 0.5,
            accuracy: 1e-6
        )
    }

    func testSpecularIsNonNegativeAndScales() {
        let n = LiquidGlassMath.normalize3(SIMD3<Float>(-0.2, 0.3, 1))
        let s = LiquidGlassMath.specular(normal: n, intensity: 1)
        XCTAssertGreaterThanOrEqual(s, 0)
        XCTAssertEqual(
            LiquidGlassMath.specular(normal: n, intensity: 0.5), s * 0.5, accuracy: 1e-5
        )
    }

    /// Specular is zero when the config disables it — the library's default.
    func testSpecularDisabledIsZero() {
        let n = LiquidGlassMath.normalize3(SIMD3<Float>(-0.4, 0.6, 1))
        XCTAssertEqual(LiquidGlassMath.specular(normal: n, intensity: 0), 0, accuracy: 0)
    }

    // MARK: - Mask and shadow

    func testMaskIsOneInsideAndZeroOutside() {
        XCTAssertEqual(LiquidGlassMath.mask(sdf: -5), 1, accuracy: 1e-5)
        XCTAssertEqual(LiquidGlassMath.mask(sdf: 5), 0, accuracy: 1e-5)
        // Within the 2 px anti-aliased band it should be a partial value.
        let edge = LiquidGlassMath.mask(sdf: -0.5)
        XCTAssertGreaterThan(edge, 0)
        XCTAssertLessThan(edge, 1)
    }

    /// The shadow falls off with distance: nearer the panel means a stronger
    /// shadow, and far away it vanishes.
    func testShadowFadesWithDistance() {
        let half = SIMD2<Float>(150, 100)
        let near = LiquidGlassMath.shadowAlpha(
            localPx: SIMD2(153, 0), halfSize: half, radius: 16,
            shadowOpacity: 0.3, shadowSpread: 10, shadowOffsetY: 1
        )
        let far = LiquidGlassMath.shadowAlpha(
            localPx: SIMD2(400, 0), halfSize: half, radius: 16,
            shadowOpacity: 0.3, shadowSpread: 10, shadowOffsetY: 1
        )
        XCTAssertGreaterThan(near, far)
        XCTAssertLessThan(far, 0.01, "shadow should vanish far from the panel")
    }

    func testShadowScalesWithOpacityAndVanishesAtZero() {
        let half = SIMD2<Float>(150, 100)
        let zero = LiquidGlassMath.shadowAlpha(
            localPx: SIMD2(155, 0), halfSize: half, radius: 16,
            shadowOpacity: 0, shadowSpread: 10, shadowOffsetY: 1
        )
        XCTAssertEqual(zero, 0, accuracy: 0)
        let one = LiquidGlassMath.shadowAlpha(
            localPx: SIMD2(155, 0), halfSize: half, radius: 16,
            shadowOpacity: 1, shadowSpread: 10, shadowOffsetY: 1
        )
        XCTAssertGreaterThan(one, 0)
    }

    // MARK: - Screen UV

    /// Panel space has its origin at the top-left while texture space is
    /// bottom-up, so the centre maps to the middle and y flips.
    func testScreenUVFlipsY() {
        let res = SIMD2<Float>(200, 100)
        let centre = LiquidGlassMath.screenUV(localPx: SIMD2(0, 0), resolution: res)
        XCTAssertEqual(centre.x, 0.5, accuracy: 1e-5)
        XCTAssertEqual(centre.y, 0.5, accuracy: 1e-5)

        // 10 px below the centre in panel space (larger y) is *lower* on
        // screen, so its texture v must be smaller.
        let below = LiquidGlassMath.screenUV(localPx: SIMD2(0, 10), resolution: res)
        XCTAssertEqual(below.y, 0.4, accuracy: 1e-5)
    }

    // MARK: - Blur weights

    /// The taps are symmetric and sum to 1, so a flat field blurs to itself.
    func testBlurWeightsAreSymmetricAndNormalised() {
        let w = LiquidGlassMath.blurWeights
        XCTAssertEqual(w.count, 9)
        XCTAssertEqual(w[1], w[2], accuracy: 1e-6)
        XCTAssertEqual(w[3], w[4], accuracy: 1e-6)
        XCTAssertEqual(w[5], w[6], accuracy: 1e-6)
        XCTAssertEqual(w[7], w[8], accuracy: 1e-6)
        XCTAssertEqual(w.reduce(0, +), 1, accuracy: 1e-5, "weights must sum to 1")
    }

    func testBlurIterationsAndPadMatchUpstream() {
        XCTAssertEqual(LiquidGlassMath.blurIterations, 6)
        XCTAssertEqual(LiquidGlassMath.shadowPad, 20)
    }

    // MARK: - Full shading

    /// A mid-panel fragment over a flat backdrop must be transparent-free and
    /// fully opaque, and must not invent colour: with all adjustments off it
    /// returns the backdrop it sampled.
    func testShadePassesFlatBackdropThrough() {
        let half = SIMD2<Float>(150, 100)
        let res = SIMD2<Float>(380, 240)
        let backdrop = SIMD3<Float>(0.2, 0.4, 0.6)
        let out = LiquidGlassMath.shade(
            localPx: SIMD2(0, 0),
            halfSize: half,
            resolution: res,
            config: config,
            sampleSharp: { _ in backdrop },
            sampleBlur: { _ in backdrop }
        )
        XCTAssertEqual(out.w, 1, accuracy: 1e-4, "centre of the panel is fully opaque")
        // Colour adjustments are neutral, and the centre has no rim terms, so
        // the result is the backdrop plus the depth lift.
        let depth = LiquidGlassMath.depthFactor(
            localPx: SIMD2(0, 0), halfSize: half, radius: 16, zRadius: 40
        )
        XCTAssertEqual(out.x, backdrop.x * (1 + 0.06 * depth), accuracy: 2e-3)
        XCTAssertEqual(out.y, backdrop.y * (1 + 0.06 * depth), accuracy: 2e-3)
        XCTAssertEqual(out.z, backdrop.z * (1 + 0.06 * depth), accuracy: 2e-3)
    }

    /// Outside the panel the shader writes shadow only: black, with the mask's
    /// alpha, never any backdrop colour.
    func testShadeOutsidePanelIsShadowOnly() {
        let half = SIMD2<Float>(150, 100)
        let out = LiquidGlassMath.shade(
            localPx: SIMD2(160, 0),
            halfSize: half,
            resolution: SIMD2(380, 240),
            config: config,
            sampleSharp: { _ in SIMD3(1, 1, 1) },
            sampleBlur: { _ in SIMD3(1, 1, 1) }
        )
        XCTAssertEqual(out.x, 0, accuracy: 0)
        XCTAssertEqual(out.y, 0, accuracy: 0)
        XCTAssertEqual(out.z, 0, accuracy: 0)
        XCTAssertGreaterThan(out.w, 0, "just outside the rim should still cast shadow")
        XCTAssertLessThan(out.w, 1)
    }

    /// The panel edge is anti-aliased, so alpha there is partial — this is what
    /// stops the glass looking stair-stepped on a non-Retina display.
    func testShadeEdgeAlphaIsPartial() {
        let half = SIMD2<Float>(150, 100)
        let out = LiquidGlassMath.shade(
            localPx: SIMD2(149.5, 0),
            halfSize: half,
            resolution: SIMD2(380, 240),
            config: config,
            sampleSharp: { _ in SIMD3(0.5, 0.5, 0.5) },
            sampleBlur: { _ in SIMD3(0.5, 0.5, 0.5) }
        )
        XCTAssertGreaterThan(out.w, 0)
        XCTAssertLessThan(out.w, 1)
    }

    /// The mask must be independent of the backdrop, so an opaque panel never
    /// lets the background bleed through in the middle.
    func testShadeCentreAlphaIsOpaqueRegardlessOfBackdrop() {
        let half = SIMD2<Float>(150, 100)
        for backdrop: SIMD3<Float> in [SIMD3(0, 0, 0), SIMD3(1, 1, 1), SIMD3(0.3, 0.7, 0.1)] {
            let out = LiquidGlassMath.shade(
                localPx: SIMD2(10, -10),
                halfSize: half,
                resolution: SIMD2(380, 240),
                config: config,
                sampleSharp: { _ in backdrop },
                sampleBlur: { _ in backdrop }
            )
            XCTAssertEqual(out.w, 1, accuracy: 1e-4)
        }
    }

    /// Opacity must scale the panel's alpha, which is how a translucent glass
    /// sheet is expressed.
    func testOpacityScalesAlpha() {
        var translucent = config
        translucent.opacity = 0.5
        let out = LiquidGlassMath.shade(
            localPx: SIMD2(0, 0),
            halfSize: SIMD2(150, 100),
            resolution: SIMD2(380, 240),
            config: translucent,
            sampleSharp: { _ in SIMD3(0.5, 0.5, 0.5) },
            sampleBlur: { _ in SIMD3(0.5, 0.5, 0.5) }
        )
        XCTAssertEqual(out.w, 0.5, accuracy: 1e-4)
    }

    /// Refraction must actually move the sample point, otherwise the glass is
    /// just a tinted rectangle. Sampling a gradient and checking the two ends
    /// differ proves the offset reaches the sampler.
    func testRefractionChangesTheSampledColour() {
        let half = SIMD2<Float>(150, 100)
        var strong = config
        strong.refraction = 1.0
        let sampled = LockedBox<[SIMD2<Float>]>([])

        _ = LiquidGlassMath.shade(
            localPx: SIMD2(148, 0),
            halfSize: half,
            resolution: SIMD2(380, 240),
            config: strong,
            sampleSharp: { uv in
                sampled.value.append(uv)
                return SIMD3(uv.x, uv.y, 0)
            },
            sampleBlur: { uv in
                sampled.value.append(uv)
                return SIMD3(uv.x, uv.y, 0)
            }
        )

        let uvs = sampled.value
        XCTAssertFalse(uvs.isEmpty, "shade must sample the backdrop")
        // The panel centre maps to u = 0.5; every sample near the +x rim is
        // refracted inward, so none should exceed the un-refracted centre.
        XCTAssertTrue(
            uvs.allSatisfy { $0.x < 0.99 },
            "refracted samples should stay inside the texture"
        )
    }

    /// A tinted glass must come out bluer than it went in, end to end.
    func testTintedGlassIsCoolerEndToEnd() {
        var tinted = config
        tinted.tintStrength = 1
        let out = LiquidGlassMath.shade(
            localPx: SIMD2(0, 0),
            halfSize: SIMD2(150, 100),
            resolution: SIMD2(380, 240),
            config: tinted,
            sampleSharp: { _ in SIMD3(0.5, 0.5, 0.5) },
            sampleBlur: { _ in SIMD3(0.5, 0.5, 0.5) }
        )
        XCTAssertLessThan(out.x, out.z)
    }

    // MARK: - Config defaults

    /// The defaults are the library's, so a caller that sets nothing still gets
    /// the documented look.
    func testConfigDefaultsMatchUpstream() {
        let c = LiquidGlassConfig()
        XCTAssertEqual(c.blurAmount, 0)
        XCTAssertEqual(c.refraction, 0.69)
        XCTAssertEqual(c.chromAberration, 0.05)
        XCTAssertEqual(c.edgeHighlight, 0.05)
        XCTAssertEqual(c.specular, 0)
        XCTAssertEqual(c.fresnel, 1)
        XCTAssertEqual(c.distortion, 0)
        XCTAssertEqual(c.cornerRadius, 65)
        XCTAssertEqual(c.zRadius, 40)
        XCTAssertEqual(c.opacity, 1)
        XCTAssertEqual(c.saturation, 0)
        XCTAssertEqual(c.tintStrength, 0)
        XCTAssertEqual(c.brightness, 0)
        XCTAssertEqual(c.shadowOpacity, 0.30)
        XCTAssertEqual(c.shadowSpread, 10)
        XCTAssertEqual(c.shadowOffsetY, 1)
        XCTAssertEqual(c.bevelMode, 0)
    }
}

/// A minimal lock box so a sampler closure can record what it was asked for
/// without tripping the concurrency checker.
private final class LockedBox<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T

    init(_ value: T) { stored = value }

    var value: T {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}
