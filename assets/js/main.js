import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

await RAPIER.init({});

const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111f);
scene.fog = new THREE.Fog(0x07111f, 18, 65);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x182030, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(-5, 18, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const clock = new THREE.Clock();

const worldOctree = new Octree();
const playerCollider = new Capsule(
  new THREE.Vector3(0, 0.35, 0),
  new THREE.Vector3(0, 1, 0),
  0.35
);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
const keyStates = {};
let playerOnFloor = false;

// Mundo Físico de Rapier
const gravity = { x: 0, y: -25.0, z: 0 };
const physicsWorld = new RAPIER.World(gravity);
const physicalObjects = [];
const lasers = [];
const particles = [];

// ==========================================
// FABRICA DE 5 FIGURAS GEOMÉTRICAS CON FÍSICA
// ==========================================

function createPhysicalShape(type, x, y, z, scale, colorHex = 0x94a3b8) {
  let geometry, colliderDesc;
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.2 });

  switch (type) {
    case 'box': { // 1. CUBO
      const sx = scale * (0.8 + Math.random() * 0.4);
      const sy = scale * (0.8 + Math.random() * 0.4);
      const sz = scale * (0.8 + Math.random() * 0.4);
      geometry = new THREE.BoxGeometry(sx, sy, sz);
      colliderDesc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setFriction(0.8).setRestitution(0.05);
      break;
    }
    case 'sphere': { // 2. ESFERA
      const r = scale * 0.6;
      geometry = new THREE.SphereGeometry(r, 24, 24);
      colliderDesc = RAPIER.ColliderDesc.ball(r)
        .setFriction(0.3).setRestitution(0.6); // Alta rodadura y rebote
      break;
    }
    case 'cylinder': { // 3. CILINDRO
      const r = scale * 0.45;
      const h = scale * 1.2;
      geometry = new THREE.CylinderGeometry(r, r, h, 16);
      colliderDesc = RAPIER.ColliderDesc.cylinder(h / 2, r)
        .setFriction(0.6).setRestitution(0.1);
      break;
    }
    case 'cone': { // 4. CONO
      const r = scale * 0.55;
      const h = scale * 1.1;
      geometry = new THREE.ConeGeometry(r, h, 16);
      colliderDesc = RAPIER.ColliderDesc.cone(h / 2, r)
        .setFriction(0.7).setRestitution(0.2);
      break;
    }
    case 'icosahedron': { // 5. ICOSAEDRO (Poliedro de 20 caras)
      const r = scale * 0.55;
      geometry = new THREE.IcosahedronGeometry(r, 0);
      
      // Obtener vértices para colisionador Convex Hull en Rapier
      const pos = geometry.attributes.position.array;
      colliderDesc = RAPIER.ColliderDesc.convexHull(new Float32Array(pos))
        .setFriction(0.5).setRestitution(0.35);
      break;
    }
  }

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setCcdEnabled(true);

  const body = physicsWorld.createRigidBody(rigidBodyDesc);
  physicsWorld.createCollider(colliderDesc, body);

  physicalObjects.push({ mesh, body, initialPos: { x, y, z }, type });
}

// Generación variada y apilada de las 5 figuras por el mapa
function spawnDiverseMapShapes() {
  const palette = [0x38bdf8, 0xf43f5e, 0xfacc15, 0x4ade80, 0xa855f7, 0xf97316, 0xec4899, 0x06b6d4];
  const shapeTypes = ['box', 'sphere', 'cylinder', 'cone', 'icosahedron'];

  const zoneGrounds = [
    { minX: -4, maxX: 4, minZ: -10, maxZ: -4, baseY: 0.0 },
    { minX: -8, maxX: -4, minZ: -12, maxZ: -3, baseY: 0.0 },
    { minX: 4, maxX: 8, minZ: -12, maxZ: -3, baseY: 0.0 },
    { minX: -3, maxX: 3, minZ: -16, maxZ: -12, baseY: 2.3 },
    { minX: 6, maxX: 9, minZ: -10, maxZ: -6, baseY: 2.3 }
  ];

  // 1. TORRES MIXTAS APILADAS CON DIFERENTES FIGURAS
  const numStacks = 4;
  for (let s = 0; s < numStacks; s++) {
    const zone = zoneGrounds[s % zoneGrounds.length];
    const x = zone.minX + Math.random() * (zone.maxX - zone.minX);
    const z = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);
    const stackHeight = 3;

    let currentY = zone.baseY;

    for (let level = 0; level < stackHeight; level++) {
      const shape = shapeTypes[Math.floor(Math.random() * shapeTypes.length)];
      const scale = 0.8 + Math.random() * 0.4;
      const color = palette[Math.floor(Math.random() * palette.length)];

      currentY += scale * 0.6;
      createPhysicalShape(shape, x, currentY, z, scale, color);
      currentY += scale * 0.6;
    }
  }

  // 2. FIGURAS DISPERSAS DE TAMAÑOS VARIADOS POR TODO EL MAPA
  const totalShapes = 20;
  for (let i = 0; i < totalShapes; i++) {
    const zone = zoneGrounds[Math.floor(Math.random() * zoneGrounds.length)];
    const x = zone.minX + Math.random() * (zone.maxX - zone.minX);
    const z = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);

    const shape = shapeTypes[i % shapeTypes.length]; // Asegura la inclusión equitativa de las 5 figuras
    const scale = 0.5 + Math.random() * 1.1; // Escalas desde 0.5m a 1.6m
    const y = zone.baseY + scale + 0.1;
    const color = palette[Math.floor(Math.random() * palette.length)];

    createPhysicalShape(shape, x, y, z, scale, color);
  }
}

// Cargar el escenario e integrar colisiones estáticas
const loader = new GLTFLoader();
loader.load('./assets/models/collision-world.glb', (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material?.map) child.material.map.anisotropy = 4;

      const positions = child.geometry.attributes.position.array;
      const worldVertices = new Float32Array(positions.length);

      const vertex = new THREE.Vector3();
      for (let i = 0; i < positions.length; i += 3) {
        vertex.set(positions[i], positions[i + 1], positions[i + 2]);
        vertex.applyMatrix4(child.matrixWorld);
        worldVertices[i] = vertex.x;
        worldVertices[i + 1] = vertex.y;
        worldVertices[i + 2] = vertex.z;
      }

      let indices;
      if (child.geometry.index) {
        indices = new Uint32Array(child.geometry.index.array);
      } else {
        indices = new Uint32Array(positions.length / 3);
        for (let i = 0; i < indices.length; i++) indices[i] = i;
      }

      const trimesh = RAPIER.ColliderDesc.trimesh(worldVertices, indices)
        .setFriction(0.9)
        .setRestitution(0.0);

      physicsWorld.createCollider(trimesh);
    }
  });

  scene.add(model);
  worldOctree.fromGraphNode(model);

  spawnDiverseMapShapes();

}, undefined, (error) => console.error('Error al cargar el escenario:', error));

function getForwardVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  return playerDirection.normalize();
}

function getSideVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  playerDirection.normalize();
  playerDirection.cross(camera.up);
  return playerDirection;
}

function controls(deltaTime) {
  const speed = playerOnFloor ? 18 : 7;
  if (keyStates.KeyW) playerVelocity.add(getForwardVector().multiplyScalar(speed * deltaTime));
  if (keyStates.KeyS) playerVelocity.add(getForwardVector().multiplyScalar(-speed * deltaTime));
  if (keyStates.KeyA) playerVelocity.add(getSideVector().multiplyScalar(-speed * deltaTime));
  if (keyStates.KeyD) playerVelocity.add(getSideVector().multiplyScalar(speed * deltaTime));
  if (playerOnFloor && keyStates.Space) playerVelocity.y = 9;
}

function playerCollisions() {
  const result = worldOctree.capsuleIntersect(playerCollider);
  playerOnFloor = false;
  if (result) {
    playerOnFloor = result.normal.y > 0;
    if (!playerOnFloor) {
      playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
    }
    playerCollider.translate(result.normal.multiplyScalar(result.depth));
  }
}

function pushNearbyObjects() {
  const moving = new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z);
  if (moving.lengthSq() < 0.04) return;
  for (const item of physicalObjects) {
    const p = item.body.translation();
    const dx = p.x - camera.position.x;
    const dz = p.z - camera.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.3) {
      const force = 1.0 / Math.max(d, 0.25);
      item.body.applyImpulse({ x: dx * force, y: 0.1, z: dz * force }, true);
      // Aplicar toque de rotación al empujarlo físicamente
      item.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.5, y: 0.2, z: (Math.random() - 0.5) * 0.5 }, true);
    }
  }
}

function updatePlayer(deltaTime) {
  let damping = Math.exp(-4 * deltaTime) - 1;
  if (!playerOnFloor) {
    playerVelocity.y -= 25 * deltaTime;
    damping *= 0.1;
  }
  playerVelocity.addScaledVector(playerVelocity, damping);
  playerCollider.translate(playerVelocity.clone().multiplyScalar(deltaTime));
  playerCollisions();
  camera.position.copy(playerCollider.end);
  pushNearbyObjects();

  if (camera.position.y < -20) {
    playerCollider.start.set(0, 0.35, 0);
    playerCollider.end.set(0, 1, 0);
    playerVelocity.set(0, 0, 0);
    camera.position.copy(playerCollider.end);
  }
}

// --- DISPARO CON IMPULSO DINÁMICO Y TORQUE DE GIRO REALISTA ---

function shootLaser() {
  if (document.pointerLockElement !== renderer.domElement) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();

  // 1. Muzzle Flash
  const muzzleFlash = new THREE.PointLight(0x38bdf8, 14, 6);
  muzzleFlash.position.copy(camera.position).addScaledVector(direction, 0.5);
  scene.add(muzzleFlash);
  setTimeout(() => scene.remove(muzzleFlash), 40);

  // 2. Proyectil compuesto
  const laserGroup = new THREE.Group();

  const coreGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8);
  coreGeo.rotateX(Math.PI / 2);
  const coreMesh = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  laserGroup.add(coreMesh);

  const glowGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8);
  glowGeo.rotateX(Math.PI / 2);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    emissive: 0x38bdf8,
    emissiveIntensity: 6,
    transparent: true,
    opacity: 0.85
  });
  laserGroup.add(new THREE.Mesh(glowGeo, glowMat));

  laserGroup.position.copy(camera.position).addScaledVector(direction, 0.6);
  laserGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  
  const laserLight = new THREE.PointLight(0x38bdf8, 4, 6);
  laserGroup.add(laserLight);

  scene.add(laserGroup);

  lasers.push({ group: laserGroup, direction, speed: 48, life: 1.5 });
}

function createImpact(position, normal) {
  const flash = new THREE.PointLight(0x38bdf8, 12, 7);
  flash.position.copy(position);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 70);

  const particleCount = 14;
  const pGeo = new THREE.SphereGeometry(0.035, 4, 4);
  const pMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });

  for (let i = 0; i < particleCount; i++) {
    const pMesh = new THREE.Mesh(pGeo, pMat);
    pMesh.position.copy(position);

    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 14 + (normal ? normal.x * 6 : 0),
      Math.random() * 9 + 2 + (normal ? normal.y * 6 : 0),
      (Math.random() - 0.5) * 14 + (normal ? normal.z * 6 : 0)
    );

    scene.add(pMesh);
    particles.push({ mesh: pMesh, velocity, life: 0.35 + Math.random() * 0.25 });
  }
}

function updateLasers(deltaTime) {
  const meshes = physicalObjects.map((item) => item.mesh);
  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];
    const distance = laser.speed * deltaTime;
    const ray = new THREE.Raycaster(laser.group.position, laser.direction, 0, distance + 0.5);
    const hit = ray.intersectObjects(meshes, false)[0];

    if (hit) {
      const item = physicalObjects.find((entry) => entry.mesh === hit.object);
      if (item) {
        // Impulso lineal
        item.body.applyImpulse({
          x: laser.direction.x * 15,
          y: laser.direction.y * 15 + 3,
          z: laser.direction.z * 15
        }, true);

        // Impulso angular (Torque de rotación al impacto)
        item.body.applyTorqueImpulse({
          x: (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 4,
          z: (Math.random() - 0.5) * 4
        }, true);
      }
      createImpact(hit.point, hit.face ? hit.face.normal : null);
      scene.remove(laser.group);
      lasers.splice(i, 1);
      continue;
    }

    laser.group.position.addScaledVector(laser.direction, distance);
    laser.life -= deltaTime;
    if (laser.life <= 0) {
      scene.remove(laser.group);
      lasers.splice(i, 1);
    }
  }
}

function updateParticles(deltaTime) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.velocity.y -= 22 * deltaTime;
    p.mesh.position.addScaledVector(p.velocity, deltaTime);
    p.life -= deltaTime;

    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }
}

function syncPhysics() {
  for (const item of physicalObjects) {
    const p = item.body.translation();
    const q = item.body.rotation();

    if (p.y < -12) {
      item.body.setTranslation({ x: item.initialPos.x, y: item.initialPos.y + 0.5, z: item.initialPos.z }, true);
      item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      item.mesh.position.set(p.x, p.y, p.z);
      item.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }
}

document.addEventListener('keydown', (event) => keyStates[event.code] = true);
document.addEventListener('keyup', (event) => keyStates[event.code] = false);
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  camera.rotation.y -= event.movementX / 500;
  camera.rotation.x -= event.movementY / 500;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x, -Math.PI / 2, Math.PI / 2);
});
document.addEventListener('mousedown', (event) => {
  if (event.button === 0) shootLaser();
});

function animate() {
  const delta = Math.min(0.05, clock.getDelta());
  controls(delta);
  updatePlayer(delta);
  physicsWorld.timestep = delta;
  physicsWorld.step();
  syncPhysics();
  updateLasers(delta);
  updateParticles(delta);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});