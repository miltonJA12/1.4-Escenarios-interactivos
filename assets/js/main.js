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

// Crear cubo dinámico individual con CCD para no traspasar paredes
function createDynamicBox(x, y, z, sx, sy, sz, mass = 4, colorHex = 0x94a3b8) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5, metalness: 0.1 })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setCcdEnabled(true);

  const body = physicsWorld.createRigidBody(rigidBodyDesc);

  const collider = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
    .setDensity(mass / Math.max(sx * sy * sz, 0.01))
    .setFriction(0.8)
    .setRestitution(0.05);

  physicsWorld.createCollider(collider, body);

  physicalObjects.push({ mesh, body, initialPos: { x, y, z } });
}

// Generación ALEATORIA de cubos dispersos y apilados por todo el mapa
function spawnRandomMapBoxes() {
  const palette = [0x38bdf8, 0xf43f5e, 0xfacc15, 0x4ade80, 0xa855f7, 0xf97316, 0xec4899, 0x10b981];

  // Zonas de suelo seguro en el mapa (Central, Izquierda, Derecha, Fondo y Plataformas)
  const zoneGrounds = [
    { minX: -4, maxX: 4, minZ: -10, maxZ: -4, baseY: 0.0 },     // Patio central
    { minX: -8, maxX: -4, minZ: -12, maxZ: -3, baseY: 0.0 },    // Pasillo izquierdo
    { minX: 4, maxX: 8, minZ: -12, maxZ: -3, baseY: 0.0 },     // Pasillo derecho
    { minX: -3, maxX: 3, minZ: -16, maxZ: -12, baseY: 2.3 },   // Plataforma trasera elevada
    { minX: 6, maxX: 9, minZ: -10, maxZ: -6, baseY: 2.3 }      // Plataforma derecha elevada
  ];

  // 1. GENERAR CUBOS APILADOS EN TORRES ALEATORIAS
  const numStacks = 3 + Math.floor(Math.random() * 3); // Entre 3 y 5 torres
  for (let s = 0; s < numStacks; s++) {
    const zone = zoneGrounds[Math.floor(Math.random() * zoneGrounds.length)];
    const x = zone.minX + Math.random() * (zone.maxX - zone.minX);
    const z = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);
    const stackHeight = 2 + Math.floor(Math.random() * 3); // 2 a 4 niveles de altura

    let currentY = zone.baseY;

    for (let level = 0; level < stackHeight; level++) {
      // Tamaños aleatorios para los bloques de la torre (de 0.5m a 1.2m)
      const sizeX = 0.5 + Math.random() * 0.7;
      const sizeY = 0.5 + Math.random() * 0.7;
      const sizeZ = 0.5 + Math.random() * 0.7;
      const color = palette[Math.floor(Math.random() * palette.length)];

      currentY += sizeY / 2;
      createDynamicBox(x, currentY, z, sizeX, sizeY, sizeZ, 3 + sizeY * 2, color);
      currentY += sizeY / 2; // Elevar el punto de origen para el siguiente piso de la torre
    }
  }

  // 2. GENERAR CUBOS DISPERSOS DE DIVERSOS TAMAÑOS
  const totalLooseBoxes = 12 + Math.floor(Math.random() * 8); // Entre 12 y 20 cubos sueltos
  for (let i = 0; i < totalLooseBoxes; i++) {
    const zone = zoneGrounds[Math.floor(Math.random() * zoneGrounds.length)];
    const x = zone.minX + Math.random() * (zone.maxX - zone.minX);
    const z = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);

    // Tamaños muy variados (pequeños de 0.4m hasta bloques gigantes de 1.6m)
    const sx = 0.4 + Math.random() * 1.2;
    const sy = 0.4 + Math.random() * 1.2;
    const sz = 0.4 + Math.random() * 1.2;

    const y = zone.baseY + sy / 2 + 0.05; // Descansa directamente sobre el suelo de la zona
    const color = palette[Math.floor(Math.random() * palette.length)];

    createDynamicBox(x, y, z, sx, sy, sz, 2 + sx * sy * sz * 3, color);
  }
}

// Cargar el escenario e integrar colisiones
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

  // Generar la disposición aleatoria de cubos
  spawnRandomMapBoxes();

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
    if (d < 1.2) {
      const force = 0.9 / Math.max(d, 0.25);
      item.body.applyImpulse({ x: dx * force, y: 0.1, z: dz * force }, true);
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

function shootLaser() {
  if (document.pointerLockElement !== renderer.domElement) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();

  const geometry = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 10);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,
    emissive: 0x22d3ee,
    emissiveIntensity: 5
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(camera.position).addScaledVector(direction, 0.8);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  scene.add(mesh);

  lasers.push({ mesh, direction, speed: 35, life: 1.5 });
}

function createImpact(position) {
  const flash = new THREE.PointLight(0x67e8f9, 8, 4, 2);
  flash.position.copy(position);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 90);
}

function updateLasers(deltaTime) {
  const meshes = physicalObjects.map((item) => item.mesh);
  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];
    const distance = laser.speed * deltaTime;
    const ray = new THREE.Raycaster(laser.mesh.position, laser.direction, 0, distance + 0.5);
    const hit = ray.intersectObjects(meshes, false)[0];

    if (hit) {
      const item = physicalObjects.find((entry) => entry.mesh === hit.object);
      if (item) {
        item.body.applyImpulse({
          x: laser.direction.x * 10,
          y: laser.direction.y * 10 + 1.5,
          z: laser.direction.z * 10
        }, true);
      }
      createImpact(hit.point);
      scene.remove(laser.mesh);
      lasers.splice(i, 1);
      continue;
    }

    laser.mesh.position.addScaledVector(laser.direction, distance);
    laser.life -= deltaTime;
    if (laser.life <= 0) {
      scene.remove(laser.mesh);
      lasers.splice(i, 1);
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
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});