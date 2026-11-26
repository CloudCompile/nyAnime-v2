import * as THREE from "three";

export interface TheaterHandle {
  session: XRSession;
}

interface TheaterOptions {
  title?: string;
}

/** Seconds skipped per thumbstick push. */
const SEEK_STEP = 10;
const SEEK_COOLDOWN_MS = 600;

function makeHintTexture(title?: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(8, 8, 16, 0.72)";
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 36);
    ctx.fill();

    ctx.textAlign = "center";
    if (title) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 46px system-ui, sans-serif";
      ctx.fillText(title.slice(0, 44), canvas.width / 2, 96, canvas.width - 80);
    }
    ctx.fillStyle = "#a78bfa";
    ctx.font = "500 34px system-ui, sans-serif";
    ctx.fillText("Trigger: play / pause", canvas.width / 2, 184);
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fillText("Thumbstick: seek 10s", canvas.width / 2, 248);
    ctx.fillText("System menu: exit theater", canvas.width / 2, 312);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Starts an immersive session and renders the room around an existing
 * `<video>` element.
 *
 * `requestSession` is the first statement on purpose: browsers require a user
 * activation, so the caller must invoke this directly from a click handler
 * rather than after awaiting something else.
 *
 * The screen samples the video through a `VideoTexture` rather than a
 * WebXR media layer. That keeps the whole experience in one WebGL layer (a
 * media layer cannot be mixed with a three.js base layer without taking over
 * the render state by hand), and the source is 720p, so the extra copy is not
 * the bottleneck. Swapping in `XRMediaBinding.createQuadLayer(video, …)` is
 * the next quality step once it is verified on the target headset.
 */
export async function enterTheater(
  video: HTMLVideoElement,
  options: TheaterOptions = {},
): Promise<TheaterHandle> {
  const xr = navigator.xr;
  if (!xr) throw new Error("WebXR is not available in this browser.");

  const session = await xr.requestSession("immersive-vr", {
    optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
  });

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(1, 1, false);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  // The canvas is never shown on the page; the headset gets the framebuffer.
  renderer.domElement.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04040a);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const addMesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    rotation?: [number, number, number],
  ) => {
    geometries.push(geometry);
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    scene.add(mesh);
    return mesh;
  };

  // Room: a floor, a back wall and a faint ceiling so the space reads as a
  // room rather than a floating rectangle in the void.
  addMesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ color: 0x0b0b14 }),
    [0, 0, 0],
    [-Math.PI / 2, 0, 0],
  );
  addMesh(
    new THREE.PlaneGeometry(26, 14),
    new THREE.MeshBasicMaterial({ color: 0x07070e }),
    [0, 5.5, -10],
  );
  addMesh(
    new THREE.PlaneGeometry(26, 14),
    new THREE.MeshBasicMaterial({ color: 0x05050b }),
    [0, 7.5, 0],
    [Math.PI / 2, 0, 0],
  );

  // Screen: 16:9 at 7 m, centred slightly above eye height.
  const videoTexture = new THREE.VideoTexture(video);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.generateMipmaps = false;
  textures.push(videoTexture);

  addMesh(
    new THREE.PlaneGeometry(8.4, 4.9),
    new THREE.MeshBasicMaterial({ color: 0x171722 }),
    [0, 2.7, -7.04],
  );
  addMesh(
    new THREE.PlaneGeometry(8, 4.5),
    new THREE.MeshBasicMaterial({ map: videoTexture }),
    [0, 2.7, -7],
  );
  addMesh(
    new THREE.PlaneGeometry(8.4, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x8b5cf6 }),
    [0, 0.32, -6.99],
  );

  const hintTexture = makeHintTexture(options.title);
  textures.push(hintTexture);
  // Above the screen, like a marquee: it stays in view without covering any
  // part of the picture.
  addMesh(
    new THREE.PlaneGeometry(2.8, 1.05),
    new THREE.MeshBasicMaterial({ map: hintTexture, transparent: true, opacity: 0.9 }),
    [0, 5.55, -7],
  );

  const togglePlayback = () => {
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };
  session.addEventListener("select", togglePlayback);

  try {
    await renderer.xr.setSession(session);
  } catch (error) {
    // Without this the headset would sit in an empty session forever.
    session.end().catch(() => undefined);
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }

  let lastSeek = 0;
  renderer.setAnimationLoop((time) => {
    // Thumbstick seek: axes[2] is left/right on a Touch controller.
    if (video.duration && Number.isFinite(video.duration)) {
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes;
        if (!axes || axes.length < 3) continue;
        const horizontal = axes[2] ?? 0;
        if (Math.abs(horizontal) > 0.75 && time - lastSeek > SEEK_COOLDOWN_MS) {
          lastSeek = time;
          video.currentTime = Math.min(
            Math.max(0, video.duration - 1),
            Math.max(0, video.currentTime + Math.sign(horizontal) * SEEK_STEP),
          );
        }
      }
    }
    renderer.render(scene, camera);
  });

  const cleanup = () => {
    renderer.setAnimationLoop(null);
    session.removeEventListener("select", togglePlayback);
    video.pause();
    textures.forEach((texture) => texture.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  };
  session.addEventListener("end", cleanup, { once: true });

  return { session };
}
