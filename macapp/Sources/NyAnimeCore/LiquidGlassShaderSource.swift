import Foundation

/// The Metal Shading Language source for the liquid-glass effect.
///
/// A port of the GLSL in `ybouane/liquidglass` (`src/shaders.ts`): `VS_QUAD`,
/// `FS_BLIT`, `FS_BLUR`, `VS_GLASS` and `FS_GLASS`. The arithmetic is kept in
/// the original's order so the two can be compared line by line, and the
/// pure-maths half of it is mirrored in `LiquidGlassMath` with unit tests.
///
/// It lives here as a string rather than as a `.metal` resource for two
/// reasons:
///
/// 1. `scripts/bundle-app.sh` assembles the `.app` by hand and copies only the
///    binary, so a SwiftPM resource bundle would not ship. A compiled-at-runtime
///    string works both under `swift run` and in the bundle.
/// 2. Keeping it in `NyAnimeCore` lets the test suite compile it on macOS
///    (`LiquidGlassShaderCompileTests`), so a syntax error fails CI rather than
///    surfacing as a blank window at launch.
public enum LiquidGlassShaderSource {

    /// The complete shader library, compiled once per device.
    public static let metal = #"""
//
//  Liquid glass — Metal port of ybouane/liquidglass (src/shaders.ts).
//
//  Function-by-function translation of the GLSL. The original targets WebGL 1
//  (GLSL ES 1.0), so this uses `float`/`float4` rather than half precision and
//  keeps the GLSL coordinate conventions: panel space has its origin at the
//  top-left, and the backdrop texture is stored flipped so that v = 1 is the
//  top of the image (matching GL's UNPACK_FLIP_Y_WEBGL upload).
//

#include <metal_stdlib>
using namespace metal;

struct QuadOut {
    float4 position [[position]];
    float2 uv;
};

struct GlassOut {
    float4 position [[position]];
    float2 localPx;
    float2 screenUV;
};

// ── VS_QUAD ──────────────────────────────────────────────
vertex QuadOut glass_quad_vertex(uint vid [[vertex_id]],
                                 constant float2 *corners [[buffer(0)]]) {
    float2 p = corners[vid];
    QuadOut out;
    out.position = float4(p, 0.0, 1.0);
    out.uv = p * 0.5 + 0.5;
    return out;
}

// ── VS_GLASS ─────────────────────────────────────────────
// Places the padded panel in NDC and computes the per-fragment local-pixel
// coordinate plus the screen UV used to sample the backdrop.
vertex GlassOut glass_panel_vertex(uint vid [[vertex_id]],
                                   constant float2 *corners [[buffer(0)]],
                                   constant float2 &center [[buffer(1)]],
                                   constant float2 &size [[buffer(2)]],
                                   constant float2 &res [[buffer(3)]],
                                   constant float &pad [[buffer(4)]]) {
    float2 a_pos = corners[vid];
    float2 total = size + float2(pad * 2.0);

    GlassOut out;
    out.localPx = a_pos * total;
    float2 px = center + a_pos * total;
    out.screenUV = float2(px.x / res.x, 1.0 - px.y / res.y);
    float2 ndc = (px / res) * 2.0 - 1.0;
    ndc.y = -ndc.y;
    out.position = float4(ndc, 0.0, 1.0);
    return out;
}

// ── FS_BLIT ──────────────────────────────────────────────
fragment float4 glass_blit_fragment(QuadOut in [[stage_in]],
                                    texture2d<float> tex [[texture(0)]],
                                    constant float2 &scale [[buffer(0)]],
                                    constant float2 &offset [[buffer(1)]]) {
    constexpr sampler s(mag_filter::linear, min_filter::linear,
                        address::clamp_to_edge);
    return tex.sample(s, in.uv * scale + offset);
}

// ── FS_BLUR ──────────────────────────────────────────────
// 9-tap Gaussian, one direction. Run twice per iteration (H then V).
fragment float4 glass_blur_fragment(QuadOut in [[stage_in]],
                                    texture2d<float> tex [[texture(0)]],
                                    constant float2 &dir [[buffer(0)]]) {
    constexpr sampler s(mag_filter::linear, min_filter::linear,
                        address::clamp_to_edge);
    float4 sum = tex.sample(s, in.uv) * 0.227027;
    sum += tex.sample(s, in.uv + dir * 1.0) * 0.194594;
    sum += tex.sample(s, in.uv - dir * 1.0) * 0.194594;
    sum += tex.sample(s, in.uv + dir * 2.0) * 0.121622;
    sum += tex.sample(s, in.uv - dir * 2.0) * 0.121622;
    sum += tex.sample(s, in.uv + dir * 3.0) * 0.054054;
    sum += tex.sample(s, in.uv - dir * 3.0) * 0.054054;
    sum += tex.sample(s, in.uv + dir * 4.0) * 0.016216;
    sum += tex.sample(s, in.uv - dir * 4.0) * 0.016216;
    return sum;
}

// ── FS_GLASS ─────────────────────────────────────────────
// Per-panel uniforms, in one struct so a draw is a single bind. Field order
// and meaning follow the GLSL uniform block.
struct GlassUniforms {
    float2 size;
    float radius;
    float2 res;
    float refract;
    float chroma;
    float edgeHL;
    float spec;
    float fresnel;
    float distort;
    float alpha;
    float sat;
    float tint;
    float zRadius;
    float brightness;
    float shadowAlpha;
    float shadowSpread;
    float shadowOffY;
    float bevelMode;
};

// Rounded-rect signed distance.
static float rr_sdf(float2 p, float2 b, float r) {
    float2 q = abs(p) - b + float2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, float2(0.0))) - r;
}

// Bevel height field: half-circle cross-section.
static float bevel_height(float d, float zR) {
    if (d <= 0.0) return 0.0;
    if (d >= zR) return zR;
    return sqrt(d * (2.0 * zR - d));
}

// GLSL fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453).
static float glass_hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

fragment float4 glass_fragment(GlassOut in [[stage_in]],
                               texture2d<float> bgTex [[texture(0)]],
                               texture2d<float> blurTex [[texture(1)]],
                               constant GlassUniforms &u [[buffer(0)]]) {
    constexpr sampler s(mag_filter::linear, min_filter::linear,
                        address::clamp_to_edge);

    float2 half_ = u.size * 0.5;
    float r = min(u.radius, min(half_.x, half_.y));
    float sdf = rr_sdf(in.localPx, half_, r);

    // Shadow: outside the panel, offset downward.
    if (sdf > 0.0) {
        float sdfShadow = rr_sdf(in.localPx - float2(0.0, u.shadowOffY), half_, r);
        float d = max(sdfShadow - 1.0, 0.0);
        float spread = max(u.shadowSpread, 1.0);
        float falloff = 1.0 / (spread * spread);
        float outerShadow = exp(-d * d * falloff) * 0.65;
        float contactShadow = exp(-d * 0.08 / max(spread * 0.04, 0.01)) * 0.35;
        float shadow = (outerShadow + contactShadow) * u.shadowAlpha;
        return float4(0.0, 0.0, 0.0, shadow);
    }

    // Anti-aliased panel mask.
    float mask = 1.0 - smoothstep(-1.5, 0.5, sdf);

    float maxD = min(half_.x, half_.y);
    float inside = -sdf;
    float edge = smoothstep(maxD * 0.35, 0.0, inside);

    // Surface normal from the bevel height field.
    float zR = u.zRadius;
    float e = 2.0;
    float dC = inside;
    float dR = -rr_sdf(in.localPx + float2(e, 0.0), half_, r);
    float dL = -rr_sdf(in.localPx - float2(e, 0.0), half_, r);
    float dU = -rr_sdf(in.localPx + float2(0.0, e), half_, r);
    float dD = -rr_sdf(in.localPx - float2(0.0, e), half_, r);
    float hC = bevel_height(dC, zR);
    float hR = bevel_height(dR, zR);
    float hL = bevel_height(dL, zR);
    float hU = bevel_height(dU, zR);
    float hD = bevel_height(dD, zR);
    float2 hGrad = float2(hR - hL, hU - hD) / (2.0 * e);
    float3 N = normalize(float3(-hGrad, 1.0));

    float depth = smoothstep(0.0, zR, inside);

    // Refraction.
    float2 pxToUV = float2(1.0, -1.0) / u.res;
    float ior = 1.5;
    float refrPow = 1.0 - 1.0 / ior;
    float thickness = hC * 2.0;
    float thickNorm = thickness / max(zR * 2.0, 1.0);
    float2 refrPx;
    if (u.bevelMode < 0.5) {
        // Biconvex: dual-surface refraction.
        float2 exitRefr = hGrad * refrPow;
        float2 entryRefr = hGrad * refrPow;
        float2 throughRefr = entryRefr * thickNorm * 0.5;
        refrPx = (exitRefr + entryRefr + throughRefr) * u.refract * 30.0;
        float2 centerDir = -in.localPx / max(half_, float2(1.0));
        refrPx += centerDir * u.refract * 4.0 * depth;
    } else {
        // Dome (plano-convex): magnify by contracting toward the centre.
        refrPx = -in.localPx * u.refract * depth * 0.35;
    }
    float2 refr = refrPx * pxToUV;

    // Micro-distortion noise.
    float2 ns = in.localPx * 0.08;
    float2 absPxToUV = float2(1.0) / u.res;
    float2 micro = (float2(glass_hash(ns), glass_hash(ns + float2(37.0))) - 0.5)
                 * u.distort * 4.0 * absPxToUV;

    // Chromatic aberration.
    float caS = u.chroma * 18.0 * (edge * 0.7 + 0.3) * 2.0;
    float2 caD = N.xy * caS * pxToUV;
    float2 base = in.screenUV + refr + micro;

    float3 sharp = float3(
        bgTex.sample(s, base + caD).r,
        bgTex.sample(s, base).g,
        bgTex.sample(s, base - caD).b
    );
    float3 blur = float3(
        blurTex.sample(s, base + caD).r,
        blurTex.sample(s, base).g,
        blurTex.sample(s, base - caD).b
    );

    // Edge-weighted blur mix: centre uses the blur, the rim leans sharp so the
    // refracted edge stays crisp.
    float edgeMix = (1.0 - edge * 0.15);
    float3 col = mix(sharp, blur, edgeMix);

    col *= 1.0 + u.brightness;

    float lum = dot(col, float3(0.299, 0.587, 0.114));
    col = mix(float3(lum), col, 1.0 + u.sat);

    col = mix(col, col * float3(0.92, 0.95, 1.05), u.tint);
    col *= 1.0 + 0.06 * depth;

    float fres = pow(1.0 - abs(N.z), 4.0) * u.fresnel;

    // Specular: multi-light Blinn-Phong.
    float3 V = float3(0.0, 0.0, 1.0);
    float3 L1 = normalize(float3(0.4, 0.7, 1.0));
    float sp1 = pow(max(dot(N, normalize(L1 + V)), 0.0), 90.0);
    float3 L2 = normalize(float3(-0.3, -0.5, 1.0));
    float sp2 = pow(max(dot(N, normalize(L2 + V)), 0.0), 50.0) * 0.3;
    float3 L3 = normalize(float3(0.1, 0.3, 1.0));
    float spB = pow(max(dot(N, L3), 0.0), 6.0) * 0.1;
    float3 L4 = normalize(float3(0.0, 0.9, 0.4));
    float sp4 = pow(max(dot(N, normalize(L4 + V)), 0.0), 120.0) * 0.6;
    float totalSpec = (sp1 + sp2 + spB + sp4) * u.spec;

    // Inner border stroke, biased to the top edge.
    float borderWidth = 1.5;
    float innerStroke = smoothstep(-borderWidth - 1.0, -borderWidth, sdf)
                      * (1.0 - smoothstep(-1.0, 0.0, sdf));
    float topBias = 0.5 + 0.5 * (-in.localPx.y / half_.y);
    innerStroke *= (0.4 + 0.6 * topBias);

    float rim = edge * u.edgeHL * 0.22;
    float innerGlow = smoothstep(5.0, 0.0, -sdf) * u.edgeHL * 0.15;

    float envRefl = (N.y * 0.5 + 0.5) * fres * 0.08;

    float3 fin = col;
    fin += float3(totalSpec);
    fin += float3(rim + innerGlow);
    fin += float3(innerStroke * u.edgeHL * 0.55);
    fin += float3(envRefl);
    fin = mix(fin, float3(1.0), fres * 0.2);

    return float4(fin, mask * u.alpha);
}
"""#
}
