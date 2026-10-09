"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { DivisionStatus } from "@/lib/status";
import { POS, nearestNode, planRoute } from "@/lib/office-graph";

const STATE_COLOR: Record<DivisionStatus["state"], string> = {
  asleep: "#6b7280",
  working: "#f5a623",
  needs_you: "#e5484d",
  done: "#46a758",
};

const STATE_LABEL: Record<DivisionStatus["state"], string> = {
  asleep: "tidur",
  working: "lembur",
  needs_you: "butuh kamu",
  done: "selesai",
};

const AMBER = "#ffb545";

/* ---------------------------------- bits ---------------------------------- */

function StatusRing({ color, pulse }: { color: string; pulse: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current && pulse) {
      ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.1);
    }
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
      <ringGeometry args={[0.42, 0.55, 32]} />
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Chair({ position, rotationY = 0, color = "#2b2f36" }: { position: [number, number, number]; rotationY?: number; color?: string }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[0.55, 0.07, 0.5]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.05, 0.28, 0.22, 10]} />
        <meshStandardMaterial color="#17191d" />
      </mesh>
      <mesh position={[0, 0.68, 0.26]}>
        <boxGeometry args={[0.52, 0.95, 0.07]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.24, 0.26]}>
        <boxGeometry args={[0.3, 0.18, 0.07]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {[-0.31, 0.31].map((x) => (
        <mesh key={x} position={[x, 0.55, 0]}>
          <boxGeometry args={[0.06, 0.06, 0.42]} />
          <meshStandardMaterial color="#17191d" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Kit-style worker bot, fully articulated (skill: biped-walker rig).
 * Two-joint legs, counter-swinging arms, torso lean; blends between a seated
 * desk pose and a standing stride by the `walking` flag. All pivots rotate
 * around joint origins, so nothing detaches at any angle.
 */
function Avatar({ color, dim, walking }: { color: string; dim: boolean; walking: boolean }) {
  const op = dim ? 0.4 : 1;
  const thighL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const shinL = useRef<THREE.Group>(null);
  const shinR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const torsoG = useRef<THREE.Group>(null);
  const hipsG = useRef<THREE.Group>(null);
  const headG = useRef<THREE.Group>(null);
  const visor = useRef<THREE.MeshBasicMaterial>(null);
  const phase = useRef(Math.random() * Math.PI * 2);
  const blend = useRef(0);

  useFrame(({ clock }, dt) => {
    const wTarget = walking ? 1 : 0;
    blend.current += (wTarget - blend.current) * Math.min(1, dt * 5);
    const w = blend.current;
    phase.current += dt * (4 + 3 * w);
    const p = phase.current;
    const t = clock.elapsedTime;

    // hips ride: chair height seated, full leg length standing
    if (hipsG.current) hipsG.current.position.y = 0.42 + (0.64 - 0.42) * w;
    // torso leans into the stride
    if (torsoG.current) torsoG.current.rotation.x = -0.12 * w;
    // head: idle sway seated, steady gaze walking + periodic visor blink
    if (headG.current) headG.current.rotation.y = (1 - w) * 0.18 * Math.sin(t * 0.45);
    if (visor.current) visor.current.opacity = (t % 3.7) < 0.12 ? 0.25 : 1;

    const legL = 0.55 * Math.sin(p);
    const legR = 0.55 * Math.sin(p + Math.PI);
    const set = (
      thigh: THREE.Group | null, shin: THREE.Group | null,
      swing: number, seatedThigh: number, seatedShin: number, kneePhase: number,
    ) => {
      if (thigh) thigh.rotation.x = seatedThigh + (swing - seatedThigh) * w;
      if (shin) shin.rotation.x = seatedShin + (-(0.15 + 0.55 * Math.max(0, Math.sin(p + kneePhase))) - seatedShin) * w;
    };
    set(thighL.current, shinL.current, legL, 1.35, -1.3, 2.4);
    set(thighR.current, shinR.current, legR, 1.35, -1.3, 2.4 + Math.PI);
    // arms counter-swing their same-side leg; reach for the keyboard seated
    if (armL.current) armL.current.rotation.x = 0.85 + (-0.45 * Math.sin(p) - 0.85) * w;
    if (armR.current) armR.current.rotation.x = 0.85 + (-0.45 * Math.sin(p + Math.PI) - 0.85) * w;
  });

  return (
    <group>
      <group ref={hipsG} position={[0, 0.42, 0]}>
        {/* thighs: hip pivots */}
        {[{ r: thighL, x: -0.12 }, { r: thighR, x: 0.12 }].map(({ r, x }, i) => (
          <group key={i} ref={r} position={[x, 0, 0]}>
            <mesh position={[0, -0.16, 0]}>
              <boxGeometry args={[0.13, 0.32, 0.15]} />
              <meshStandardMaterial color="#3a3f47" metalness={0.5} roughness={0.5} transparent={dim} opacity={op} />
            </mesh>
            <group ref={i === 0 ? shinL : shinR} position={[0, -0.32, 0]}>
              <mesh position={[0, -0.14, 0]}>
                <boxGeometry args={[0.11, 0.28, 0.13]} />
                <meshStandardMaterial color="#2c3138" metalness={0.5} roughness={0.5} transparent={dim} opacity={op} />
              </mesh>
              <mesh position={[0, -0.3, -0.05]}>
                <boxGeometry args={[0.12, 0.06, 0.24]} />
                <meshStandardMaterial color="#1c1f24" metalness={0.4} roughness={0.6} transparent={dim} opacity={op} />
              </mesh>
            </group>
          </group>
        ))}
        {/* torso assembly leans as one */}
        <group ref={torsoG}>
          <mesh position={[0, 0.32, 0]}>
            <boxGeometry args={[0.42, 0.5, 0.3]} />
            <meshStandardMaterial color={color} metalness={0.55} roughness={0.45} transparent={dim} opacity={op} />
          </mesh>
          <mesh position={[0, 0.36, -0.16]}>
            <boxGeometry args={[0.2, 0.06, 0.02]} />
            <meshBasicMaterial color={dim ? "#1d3a3a" : "#00f0ff"} />
          </mesh>
          {/* cyan seam lines (kit detail) */}
          {[-0.14, 0.14].map((x) => (
            <mesh key={x} position={[x, 0.32, -0.155]}>
              <boxGeometry args={[0.02, 0.4, 0.01]} />
              <meshBasicMaterial color={dim ? "#1d3a3a" : "#00f0ff"} />
            </mesh>
          ))}
          {[{ r: armL, x: -0.28 }, { r: armR, x: 0.28 }].map(({ r, x }, i) => (
            <group key={i} ref={r} position={[x, 0.5, 0]}>
              <mesh position={[0, -0.2, 0]}>
                <boxGeometry args={[0.11, 0.4, 0.13]} />
                <meshStandardMaterial color="#6b7280" metalness={0.6} roughness={0.4} transparent={dim} opacity={op} />
              </mesh>
              <mesh position={[0, -0.42, -0.02]}>
                <boxGeometry args={[0.09, 0.09, 0.12]} />
                <meshStandardMaterial color="#3a3f47" metalness={0.6} roughness={0.4} transparent={dim} opacity={op} />
              </mesh>
            </group>
          ))}
          <group ref={headG} position={[0, 0.68, 0]}>
            <mesh position={[0, 0.1, 0]}>
              <boxGeometry args={[0.3, 0.28, 0.3]} />
              <meshStandardMaterial color="#9aa2ad" metalness={0.7} roughness={0.35} transparent={dim} opacity={op} />
            </mesh>
            <mesh position={[0, 0.12, -0.16]}>
              <planeGeometry args={[0.24, 0.13]} />
              <meshBasicMaterial ref={visor} color={dim ? "#23414a" : "#00f0ff"} transparent opacity={1} />
            </mesh>
            <mesh position={[0, 0.3, 0.05]}>
              <cylinderGeometry args={[0.015, 0.015, 0.18, 6]} />
              <meshStandardMaterial color="#6b7280" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[0, 0.4, 0.05]}>
              <sphereGeometry args={[0.03, 8, 8]} />
              <meshBasicMaterial color={dim ? "#23414a" : "#00f0ff"} />
            </mesh>
          </group>
        </group>
      </group>
      {dim && (
        <Html position={[0.35, 1.6, 0]} center distanceFactor={12} style={{ pointerEvents: "none" }}>
          <div style={{ fontSize: 20, opacity: 0.9 }}>💤</div>
        </Html>
      )}
    </group>
  );
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.22, 0.17, 0.5, 12]} />
        <meshStandardMaterial color="#3a3f45" />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <icosahedronGeometry args={[0.44, 1]} />
        <meshStandardMaterial color="#3f7a3a" flatShading />
      </mesh>
      <mesh position={[0.2, 0.56, 0.1]}>
        <icosahedronGeometry args={[0.27, 1]} />
        <meshStandardMaterial color="#4c8a44" flatShading />
      </mesh>
    </group>
  );
}

/** Glowing amber strip on the floor (zone borders, walkways). */
function Strip({ from, to }: { from: [number, number]; to: [number, number] }) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dz * dz);
  const ang = Math.atan2(dz, dx);
  return (
    <mesh position={[(from[0] + to[0]) / 2, 0.025, (from[1] + to[1]) / 2]} rotation-y={-ang}>
      <boxGeometry args={[len, 0.02, 0.09]} />
      <meshBasicMaterial color={AMBER} />
    </mesh>
  );
}

function Label({ position, children }: { position: [number, number, number]; children: React.ReactNode }) {
  return (
    <Html position={position} center distanceFactor={14} style={{ pointerEvents: "none" }}>
      <div style={{ background: "rgba(10,12,16,0.82)", border: "1px solid #333", borderRadius: 8, padding: "3px 10px", fontSize: 12, whiteSpace: "nowrap", color: "#eee" }}>
        {children}
      </div>
    </Html>
  );
}

/** Kantor AI wordmark: crescent moon over a desk bar. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ verticalAlign: "-4px" }}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" fill="#00f0ff" />
      <rect x="3" y="17.2" width="18" height="2.2" rx="1.1" fill="#e8ddc4" />
    </svg>
  );
}

function Neon({ position, text, color }: { position: [number, number, number]; text: string; color: string }) {
  return (
    <Html position={position} center distanceFactor={13} style={{ pointerEvents: "none" }}>
      <div style={{ color, fontSize: 26, fontWeight: 800, textShadow: `0 0 8px ${color}, 0 0 22px ${color}`, letterSpacing: 2, whiteSpace: "nowrap" }}>
        {text}
      </div>
    </Html>
  );
}

/* ------------------------- walking avatars ------------------------- */
/* Seat origin = chair. Sitter faces the desk (-z local). Avatar lives in a
   Walker (below), NOT in the seat — so it can stroll to meeting/lounge/pantry. */

const SEATS = [
  { x: -0.95, z: -1.45, rot: Math.PI },
  { x: 0.95, z: -1.45, rot: Math.PI },
  { x: -0.95, z: 1.45, rot: 0 },
  { x: 0.95, z: 1.45, rot: 0 },
];
const POD_POS: Array<[number, number]> = [[-12, -3], [-5, -3], [2, -3], [-12, 2.5], [-5, 2.5]];
// Small divisions share pods (a 2-person pod looks abandoned). Revenue teams
// sit together, support teams sit together — like a real office.
const POD_GROUPS: Array<{ label: string; divisions: string[] }> = [
  { label: "SOSMED", divisions: ["sari", "kreatif"] },
  { label: "WEB & APLIKASI", divisions: ["dimas"] },
  { label: "PENJUALAN", divisions: ["bima", "gilang"] },
  { label: "BACK OFFICE", divisions: ["laras", "builder"] },
  { label: "OPERASIONAL", divisions: ["raka", "nadia", "dewi"] },
];

function seatWorld(px: number, pz: number, s: number): { pos: [number, number, number]; rot: number } {
  const seat = SEATS[s];
  return { pos: [px + seat.x, 0, pz + seat.z], rot: seat.rot };
}

const MEET: [number, number, number] = [9, 0, -4.5];
const LOUNGE: [number, number, number] = [3, 0, 6.5];
const PANTRY: [number, number, number] = [15.5, 0, -1];
// Pantry is rotated -90° against the east wall: stools line up west of the counter.
const PANTRY_STOOLS: Array<[number, number]> = [[14.35, -3.5], [14.35, -2.5], [14.35, -1.5], [14.35, -0.5], [14.35, 0.5], [14.35, 1.5]];

function placeAnchor(d: DivisionStatus, slot: number): { pos: [number, number, number]; rot: number } {
  if (d.place === "meeting") {
    const a = (slot / 6) * Math.PI * 2;
    return { pos: [MEET[0] + Math.cos(a) * 2.9, 0, MEET[2] + Math.sin(a) * 2.9], rot: Math.PI / 2 - a };
  }
  if (d.place === "lounge") {
    const spots: Array<[number, number]> = [[0.6, 1.2], [1.8, 1.6], [-0.6, 1.8], [0, 2.2], [-2.4, 1.4], [2.8, 1.2]];
    const s = spots[slot % spots.length];
    return { pos: [LOUNGE[0] + s[0], 0, LOUNGE[2] + s[1]], rot: 0 };
  }
  if (d.place === "pantry") {
    const s = PANTRY_STOOLS[slot % PANTRY_STOOLS.length];
    return { pos: [s[0], 0, s[1]], rot: -Math.PI / 2 };
  }
  if (d.place === "musholla") {
    // prayer rugs inside the glass musholla
    const rugs: Array<[number, number]> = [[-0.7, 0.6], [0.7, -0.7]];
    const r = rugs[slot % rugs.length];
    return { pos: [15.5 + r[0], 0, 4.8 + r[1]], rot: Math.PI };
  }
  return { pos: [0, 0, 0], rot: 0 }; // desk handled separately
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** An avatar that WALKS (lerp + bob + facing) whenever its anchor changes. */
function Walker({ d, route, rotY, selected, onSelect, activity }: {
  d: DivisionStatus;
  route: Array<[number, number]>;
  rotY: number;
  selected: boolean;
  onSelect: () => void;
  activity: string | null;
}) {
  const ref = useRef<THREE.Group>(null);
  const anim = useRef({ from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 2, leg: 0, path: [] as Array<[number, number]> });
  const lastKey = useRef("");
  const tmp = useRef(new THREE.Vector3());
  const walkingRef = useRef(false);
  const [walking, setWalking] = useState(false);

  // Mount pose ONLY (last waypoint = goal): after this, useFrame owns
  // position/rotation exclusively. Props re-asserting would teleport.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current && ref.current && route.length) {
      const g = route[route.length - 1];
      ref.current.position.set(g[0], 0, g[1]);
      ref.current.rotation.y = rotY;
      mounted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const key = route.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("|");
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    POS.set(d.id, [g.position.x, g.position.z]);
    if (lastKey.current !== key) {
      // Drop leading waypoints we're already standing on, walk the rest.
      const legs = route.filter((p) => Math.hypot(p[0] - g.position.x, p[1] - g.position.z) > 0.5);
      const first = legs[0] ?? [g.position.x, g.position.z];
      const dist = Math.hypot(first[0] - g.position.x, first[1] - g.position.z);
      anim.current = {
        from: g.position.clone(),
        to: new THREE.Vector3(first[0], 0, first[1]),
        t: dist < 0.05 ? 1 : 0,
        dur: Math.min(4, Math.max(1.2, dist / 2.4)),
        leg: 0,
        path: legs as Array<[number, number]>,
      };
      lastKey.current = key;
    }
    const a = anim.current;
    const isW = a.t < 1;
    if (isW !== walkingRef.current) {
      walkingRef.current = isW;
      setWalking(isW);
    }
    if (a.t < 1) {
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = a.t * a.t * (3 - 2 * a.t);
      g.position.lerpVectors(a.from, a.to, e);
      tmp.current.subVectors(a.to, a.from);
      if (tmp.current.lengthSq() > 0.0001) {
        const want = Math.atan2(-tmp.current.x, -tmp.current.z);
        let diff = want - g.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        g.rotation.y += diff * Math.min(1, dt * 8);
      }
      g.position.y = Math.abs(Math.sin(clock.elapsedTime * 11)) * 0.03;
      if (a.t >= 1 && a.leg + 1 < a.path.length) {
        const nx = a.path[a.leg + 1];
        const dist = Math.hypot(nx[0] - g.position.x, nx[1] - g.position.z);
        anim.current = {
          from: g.position.clone(),
          to: new THREE.Vector3(nx[0], 0, nx[1]),
          t: dist < 0.05 ? 1 : 0,
          dur: Math.min(4, Math.max(1.2, dist / 2.4)),
          leg: a.leg + 1,
          path: a.path,
        };
      }
    } else {
      g.position.y = 0;
      let diff = rotY - g.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.rotation.y += diff * Math.min(1, dt * 4);
    }
  });

  return (
    <group ref={ref} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <Avatar color={d.color} dim={d.state === "asleep"} walking={walking} />
      <Html position={[0, 2.1 + (hashId(d.id) % 3) * 0.34, 0]} center distanceFactor={12} style={{ pointerEvents: "none" }}>
        <div style={{ background: "rgba(10,12,16,0.85)", border: `1px solid ${selected ? "#fff" : activity || d.place !== "desk" ? "#00f0ff" : "#333"}`, borderRadius: 8, padding: "3px 10px", fontSize: 12, whiteSpace: "nowrap", color: "#eee" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: STATE_COLOR[d.state], marginRight: 6 }} />
          <strong>{d.name}</strong> <span style={{ opacity: 0.65 }}>{activity ?? (d.place === "desk" ? STATE_LABEL[d.state] : { meeting: "rapat", lounge: "santai", pantry: "ngopi", musholla: "rehat" }[d.place] ?? d.place)}</span>
        </div>
      </Html>
    </group>
  );
}

function WorkSeat({ d, position, rotationY, selected, onSelect }: {
  d: DivisionStatus | null;
  position: [number, number, number];
  rotationY: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const live = d && d.state !== "asleep";
  const screenGlow = !d ? "#141a24" : d.state === "working" ? "#9fd0ff" : d.state === "needs_you" ? "#ff9a9a" : "#233246";
  return (
    <group position={position} rotation-y={rotationY} onClick={(e) => { if (d) { e.stopPropagation(); onSelect(); } }}>
      {/* seat origin = chair. The avatar lives in a Walker (animates between rooms). */}
      <Chair position={[0, 0, 0]} />
      {d && <StatusRing color={STATE_COLOR[d.state]} pulse={d.state === "working"} />}
      {/* monitor riser shelf + violet underglow (kit battlestation) */}
      <mesh position={[0, 0.58, -0.7]}>
        <boxGeometry args={[1.35, 0.05, 0.5]} />
        <meshStandardMaterial color="#14171c" />
      </mesh>
      <mesh position={[0, 0.55, -0.5]}>
        <boxGeometry args={[1.3, 0.02, 0.03]} />
        <meshBasicMaterial color={d && d.state !== "asleep" ? "#8a2be2" : "#2a2135"} />
      </mesh>
      {/* dual monitors */}
      {[-0.28, 0.28].map((x, i) => (
        <group key={x} position={[x, 0, -0.7]} rotation-y={i === 0 ? 0.22 : -0.22}>
          <mesh position={[0, 1.0, 0]}>
            <boxGeometry args={[0.62, 0.4, 0.05]} />
            <meshStandardMaterial color="#14171c" />
          </mesh>
          <mesh position={[0, 1.0, 0.028]}>
            <planeGeometry args={[0.56, 0.34]} />
            <meshStandardMaterial color="#0d1117" emissive={screenGlow} emissiveIntensity={d ? 0.85 : 0.25} />
          </mesh>
          <mesh position={[0, 0.68, 0]}>
            <boxGeometry args={[0.07, 0.22, 0.05]} />
            <meshStandardMaterial color="#14171c" />
          </mesh>
        </group>
      ))}
      {/* keyboard + RGB glow + mug */}
      <mesh position={[0, 0.56, -0.4]}>
        <boxGeometry args={[0.55, 0.03, 0.2]} />
        <meshStandardMaterial color="#22262c" />
      </mesh>
      <mesh position={[0, 0.578, -0.4]}>
        <planeGeometry args={[0.5, 0.15]} />
        <meshBasicMaterial color={d && d.state === "working" ? "#00f0ff" : "#1c2b3a"} />
      </mesh>
      <mesh position={[0.48, 0.61, -0.35]}>
        <cylinderGeometry args={[0.05, 0.045, 0.11, 10]} />
        <meshStandardMaterial color={d ? d.color : "#444"} />
      </mesh>
      {/* desk keeps only its status ring; the walker's pill follows the avatar */}
    </group>
  );
}

/** A 4-seat pod: shared table, 2 seats facing 2 seats. Empty seats = open chairs. */
function Pod({ members, position, selected, onSelect, label }: {
  members: Array<DivisionStatus | null>;
  position: [number, number, number];
  selected: string | null;
  onSelect: (id: string | null) => void;
  label: string;
}) {
  const seats: Array<{ d: DivisionStatus | null; pos: [number, number, number]; rot: number }> = [
    { d: members[0] ?? null, pos: [-0.65, 0, SEATS[0].z], rot: SEATS[0].rot },
    { d: members[1] ?? null, pos: [0.65, 0, SEATS[1].z], rot: SEATS[1].rot },
    { d: members[2] ?? null, pos: [-0.65, 0, SEATS[2].z], rot: SEATS[2].rot },
    { d: members[3] ?? null, pos: [0.65, 0, SEATS[3].z], rot: SEATS[3].rot },
  ];
  return (
    <group position={position}>
      {/* shared table */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[3.0, 0.09, 2.2]} />
        <meshStandardMaterial color="#7a5636" />
      </mesh>
      {[[-1.4, -1.0], [1.4, -1.0], [-1.4, 1.0], [1.4, 1.0]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.23, z]}>
          <boxGeometry args={[0.1, 0.46, 0.1]} />
          <meshStandardMaterial color="#3a2c1e" />
        </mesh>
      ))}
      {/* shared PC towers at the table ends (clear of every chair) */}
      {[-1.85, 1.85].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.42, 0.9, 0.42]} />
            <meshStandardMaterial color="#14171c" />
          </mesh>
          {[0.62, 0.32].map((y) => (
            <mesh key={y} position={[0, y, 0.215]}>
              <torusGeometry args={[0.09, 0.022, 8, 20]} />
              <meshBasicMaterial color="#8a2be2" />
            </mesh>
          ))}
        </group>
      ))}
      {seats.map((s, i) => (
        <WorkSeat key={i} d={s.d} position={s.pos} rotationY={s.rot} selected={!!s.d && selected === s.d.id} onSelect={() => s.d && onSelect(s.d.id)} />
      ))}
      <Html position={[0, 3.3, 0]} center distanceFactor={15} style={{ pointerEvents: "none" }}>
        <div style={{ color: "#e8ddc4", fontSize: 13, fontWeight: 800, letterSpacing: 3, opacity: 0.85, whiteSpace: "nowrap" }}>
          {label}
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------- meeting room ------------------------------ */

export interface NightBoard {
  woken: number;
  pending: number;
  done: number;
  next: string;
}

function MeetingRoom({ position, board }: { position: [number, number, number]; board: NightBoard }) {
  const screen = useTexture("/img/workstation.png");
  screen.colorSpace = THREE.SRGBColorSpace;
  return (
    <group position={position}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
        <planeGeometry args={[8.4, 6.2]} />
        <meshStandardMaterial color="#1d2531" />
      </mesh>
      {/* glass walls */}
      <mesh position={[-4.2, 1.3, 0]}>
        <boxGeometry args={[0.08, 2.6, 6.2]} />
        <meshStandardMaterial color="#9fc0e8" transparent opacity={0.13} />
      </mesh>
      <mesh position={[0, 1.3, 3.1]}>
        <boxGeometry args={[8.4, 2.6, 0.08]} />
        <meshStandardMaterial color="#9fc0e8" transparent opacity={0.13} />
      </mesh>
      <mesh position={[-4.2, 2.65, 0]}>
        <boxGeometry args={[0.12, 0.1, 6.2]} />
        <meshStandardMaterial color="#2c343d" />
      </mesh>
      {/* holographic table */}
      <mesh position={[0, 0.68, 0]}>
        <cylinderGeometry args={[1.9, 2.1, 0.12, 8]} />
        <meshStandardMaterial color="#0e2a3a" emissive="#2fb9d8" emissiveIntensity={0.55} transparent opacity={0.92} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.5, 0.7, 0.5, 8]} />
        <meshStandardMaterial color="#14171c" />
      </mesh>
      <Spin>
        <mesh position={[0, 1.35, 0]}>
          <octahedronGeometry args={[0.35, 0]} />
          <meshStandardMaterial color="#9fe8ff" emissive="#5fd4f5" emissiveIntensity={1.6} flatShading />
        </mesh>
      </Spin>
      <pointLight position={[0, 2.2, 0]} color="#5fd4f5" intensity={8} distance={8} decay={2} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return <Chair key={i} position={[Math.cos(a) * 2.9, 0, Math.sin(a) * 2.9]} rotationY={-a + Math.PI / 2} color="#2e4a5a" />;
      })}
      {/* wall screen */}
      <mesh position={[0, 2, -3.02]}>
        <boxGeometry args={[3.6, 2, 0.08]} />
        <meshStandardMaterial color="#101319" />
      </mesh>
      <mesh position={[0, 2, -2.97]}>
        <planeGeometry args={[3.4, 1.8]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      <Html position={[0, 2, -2.94]} center distanceFactor={10} style={{ pointerEvents: "none" }}>
        <div style={{
          fontFamily: "var(--font-mono)", color: "#cfe3ff", fontSize: 12, lineHeight: 1.7,
          background: "rgba(9,10,15,0.78)", border: "1px solid rgba(0,240,255,0.35)",
          borderRadius: 8, padding: "8px 14px", textAlign: "center", whiteSpace: "nowrap",
        }}>
          <div style={{ fontWeight: 700, letterSpacing: 2 }}>
            <span className="live-dot" />SEMALAM
          </div>
          <div>
            <span style={{ color: "#00f0ff" }}>{board.woken} BANGUN</span>
            {" · "}
            <span style={{ color: "#ff9a9a" }}>{board.pending} TUNGGU</span>
            {" · "}
            <span style={{ color: "#10b981" }}>{board.done} SELESAI</span>
          </div>
          <div style={{ opacity: 0.75, fontSize: 11 }}>berikutnya: {board.next}</div>
        </div>
      </Html>
      <Label position={[0, 3.4, 0]}>Meeting room</Label>
    </group>
  );
}

/* ------------------------------ lounge + arcade ----------------------------- */

function Arcade({ position, rotationY = 0, color }: { position: [number, number, number]; rotationY?: number; color: string }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[0.8, 1.8, 0.7]} />
        <meshStandardMaterial color="#191d24" />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <boxGeometry args={[0.84, 0.3, 0.72]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
      <mesh position={[0, 1.25, 0.2]} rotation-x={-0.15}>
        <planeGeometry args={[0.62, 0.5]} />
        <meshStandardMaterial color="#0d1117" emissive="#7a5cff" emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[0, 0.85, 0.36]}>
        <boxGeometry args={[0.7, 0.06, 0.3]} />
        <meshStandardMaterial color="#22262c" />
      </mesh>
    </group>
  );
}

function BeanBag({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <mesh position={[position[0], 0.32, position[2]]} scale={[1, 0.72, 1]}>
      <sphereGeometry args={[0.5, 14, 14]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Lounge({ position, liveName, nextLabel }: { position: [number, number, number]; liveName: string | null; nextLabel: string }) {
  const bot = useTexture("/img/agent-bot.png");
  bot.colorSpace = THREE.SRGBColorSpace;
  const ops = useTexture("/img/workstation.png");
  ops.colorSpace = THREE.SRGBColorSpace;
  return (
    <group position={position}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
        <planeGeometry args={[9, 6.5]} />
        <meshStandardMaterial color="#232b38" />
      </mesh>
      {/* sofa */}
      <mesh position={[-1.6, 0.35, -1.4]}>
        <boxGeometry args={[3, 0.5, 1.05]} />
        <meshStandardMaterial color="#3d4451" />
      </mesh>
      <mesh position={[-1.6, 0.72, -1.85]}>
        <boxGeometry args={[3, 0.6, 0.28]} />
        <meshStandardMaterial color="#343a45" />
      </mesh>
      {/* second sofa opposite (faces the coffee table) */}
      <mesh position={[0, 0.35, 2.2]}>
        <boxGeometry args={[3, 0.5, 1.05]} />
        <meshStandardMaterial color="#3d4451" />
      </mesh>
      <mesh position={[0, 0.72, 2.65]}>
        <boxGeometry args={[3, 0.6, 0.28]} />
        <meshStandardMaterial color="#343a45" />
      </mesh>
      {/* TV console + big screen */}
      <mesh position={[1.8, 0.35, -1.6]}>
        <boxGeometry args={[2.2, 0.5, 0.5]} />
        <meshStandardMaterial color="#7a5636" />
      </mesh>
      <mesh position={[1.8, 1.25, -1.75]}>
        <boxGeometry args={[2, 1.15, 0.08]} />
        <meshStandardMaterial color="#101319" />
      </mesh>
      <mesh position={[1.8, 1.25, -1.7]}>
        <planeGeometry args={[1.9, 1.05]} />
        <meshBasicMaterial map={liveName ? ops : bot} toneMapped={false} />
      </mesh>
      <Html position={[1.8, 0.45, -1.65]} center distanceFactor={10} style={{ pointerEvents: "none" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11, color: "#cfe3ff", whiteSpace: "nowrap",
          background: "rgba(9,10,15,0.78)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6, padding: "3px 10px",
        }}>
          {liveName ? <><span className="live-dot" />LIVE · {liveName} lembur</> : `kantor tidur · lanjut ${nextLabel}`}
        </div>
      </Html>
      <Arcade position={[-3.2, 0, 1.4]} rotationY={0.5} color="#c93a5a" />
      <BeanBag position={[0.6, 0, 1.2]} color="#7a9a3f" />
      <BeanBag position={[1.8, 0, 1.6]} color="#3f8a9a" />
      <BeanBag position={[-0.6, 0, 1.8]} color="#c96a3a" />
      <BeanBag position={[-2.4, 0, 1.4]} color="#8a4ac9" />
      <BeanBag position={[2.8, 0, 1.2]} color="#c9a53a" />
      <Neon position={[1.8, 2.9, -1.6]} text="🎮" color="#ffb545" />
      <Label position={[0, 3.2, 0]}>Lounge</Label>
    </group>
  );
}

/* --------------------------------- pantry ---------------------------------- */

function Pantry({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
        <planeGeometry args={[7, 4.4]} />
        <meshStandardMaterial color="#262b33" />
      </mesh>
      {/* marble counter (extended for the bigger team) */}
      <mesh position={[0, 0.52, 0]}>
        <boxGeometry args={[6.2, 0.95, 1]} />
        <meshStandardMaterial color="#cfd3d8" />
      </mesh>
      <mesh position={[0, 1.03, 0]}>
        <boxGeometry args={[6.4, 0.07, 1.15]} />
        <meshStandardMaterial color="#e8ebee" />
      </mesh>
      {/* stools */}
      {[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x) => (
        <group key={x} position={[x, 0, 1.15]}>
          <mesh position={[0, 0.62, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.07, 12]} />
            <meshStandardMaterial color="#5a3d26" />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.6, 8]} />
            <meshStandardMaterial color="#333" />
          </mesh>
        </group>
      ))}
      {/* back shelves with goods */}
      {[1.7, 2.25].map((y) => (
        <mesh key={y} position={[0, y, -1.9]}>
          <boxGeometry args={[6, 0.07, 0.5]} />
          <meshStandardMaterial color={WOOD_DARK_FALLBACK} />
        </mesh>
      ))}
      {["#c93a5a", "#e0a53a", "#3f8a5a", "#3a6ac9", "#8a4ac9", "#c95a3a", "#4ce0c8", "#e07ab0", "#9ad05a", "#7a8ae0", "#d08a4a", "#6aa8ff"].map((c, i) => (
        <mesh key={i} position={[-2.5 + (i % 6), 1.95 + Math.floor(i / 6) * 0.55, -1.9]}>
          <boxGeometry args={[0.34, 0.42, 0.3]} />
          <meshStandardMaterial color={c} />
        </mesh>
      ))}
      {/* coffee machine */}
      <mesh position={[2.4, 1.3, -0.2]}>
        <boxGeometry args={[0.5, 0.5, 0.45]} />
        <meshStandardMaterial color="#1c1f24" />
      </mesh>
      <mesh position={[2.4, 1.32, 0.05]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial color="#ff9a3c" />
      </mesh>
      <Neon position={[0, 3.1, -1.2]} text="Pantry" color="#4ce0c8" />
    </group>
  );
}

const WOOD_DARK_FALLBACK = "#4a3826";

/* --------------------------------- musholla --------------------------------- */

function Musholla({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
        <planeGeometry args={[5.4, 4.6]} />
        <meshStandardMaterial color="#2b2620" />
      </mesh>
      {/* partition with arch cutout illusion (frame + lattice) */}
      <mesh position={[-2.7, 1.3, 0]}>
        <boxGeometry args={[0.12, 2.6, 4.6]} />
        <meshStandardMaterial color="#d8cfc0" />
      </mesh>
      {/* glass walls like the meeting room (front + open side) */}
      <mesh position={[0, 1.3, -2.3]}>
        <boxGeometry args={[5.4, 2.6, 0.08]} />
        <meshStandardMaterial color="#9fc0e8" transparent opacity={0.13} />
      </mesh>
      <mesh position={[0, 2.65, -2.3]}>
        <boxGeometry args={[5.4, 0.1, 0.12]} />
        <meshStandardMaterial color="#2c343d" />
      </mesh>
      <mesh position={[1.4, 1.3, 2.3]}>
        <boxGeometry args={[2.6, 2.6, 0.08]} />
        <meshStandardMaterial color="#9fc0e8" transparent opacity={0.13} />
      </mesh>
      <mesh position={[-2.62, 1.5, 0]}>
        <planeGeometry args={[2.6, 1.6]} />
        <meshStandardMaterial color="#8a7a5c" emissive="#a8905c" emissiveIntensity={0.25} />
      </mesh>
      {/* prayer rugs */}
      {[[-0.7, 0.6], [0.7, -0.7]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
            <planeGeometry args={[0.9, 1.7]} />
            <meshStandardMaterial color="#2e5a3e" />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]}>
            <planeGeometry args={[0.7, 1.5]} />
            <meshStandardMaterial color="#3a6a4a" />
          </mesh>
        </group>
      ))}
      {/* lanterns */}
      {[[-1.8, -1.6], [1.8, 1.6]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.16, 0.2, 0.6, 8]} />
            <meshStandardMaterial color="#3a2c1e" emissive="#ffca7a" emissiveIntensity={0.5} />
          </mesh>
          <pointLight position={[0, 0.9, 0]} color="#ffca7a" intensity={4} distance={5} decay={2} />
        </group>
      ))}
      <Label position={[0, 3, 0]}>Musholla 🕌</Label>
    </group>
  );
}

/* ------------------------------- server corner ------------------------------ */

function ServerRack({ position }: { position: [number, number, number] }) {
  const leds = useRef<THREE.Mesh[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    leds.current.forEach((m, i) => {
      if (!m) return;
      const on = Math.sin(t * (2 + i * 0.7) + i * 2) > -0.2;
      (m.material as THREE.MeshBasicMaterial).color.set(on ? (i % 2 ? "#46d858" : "#ff9a3c") : "#1a2a1a");
    });
  });
  return (
    <group position={position}>
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[1.1, 2, 0.9]} />
        <meshStandardMaterial color="#14171c" />
      </mesh>
      {[0.4, 0.9, 1.4].map((y, i) => (
        <mesh key={y} ref={(m) => { if (m) leds.current[i] = m; }} position={[0.2, y, 0.46]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#46d858" />
        </mesh>
      ))}
      <Label position={[0, 2.5, 0]}>Server kamu 🖥️</Label>
    </group>
  );
}

/* ------------------------------ ceiling tracks ------------------------------ */

function TrackLights() {
  return (
    <group>
      {[-8, 0, 8].map((x) => (
        <group key={x} position={[x, 5.4, 0]}>
          <mesh rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.05, 0.05, 12, 8]} />
            <meshStandardMaterial color="#0c0e12" />
          </mesh>
          {[-4.5, -1.5, 1.5, 4.5].map((z) => (
            <group key={z} position={[0, -0.25, z]}>
              <mesh>
                <cylinderGeometry args={[0.09, 0.13, 0.3, 10]} />
                <meshStandardMaterial color="#0c0e12" />
              </mesh>
              <mesh position={[0, -0.16, 0]}>
                <sphereGeometry args={[0.06, 8, 8]} />
                <meshBasicMaterial color="#ffe2b0" />
              </mesh>
            </group>
          ))}
        </group>
      ))}
      {/* hanging plants */}
      {[[-12, -3], [4, -3], [12, 3]].map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 5.4, z]}>
          <mesh position={[0, -0.5, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 1, 6]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0, -1.35, 0]}>
            <icosahedronGeometry args={[0.5, 1]} />
            <meshStandardMaterial color="#3f7a3a" flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Slow turntable for hero props (holo crystal). */
function Spin({ children, speed = 0.8 }: { children: React.ReactNode; speed?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed;
  });
  return <group ref={ref}>{children}</group>;
}

/** Ambient life director: idle bots (asleep/done, at their desk) wander the
 *  office on their own — lounge, pantry, musholla, meeting, corridor strolls —
 *  then drift back. Workers (working/needs_you) and summoned bots never roam.
 *  Spots are occupancy-tracked so two bots never take the same stool. */
const NODES: Array<[number, number]> = [[8, 5.2], [2.5, 1.2], [-1, 9.2], [-14, 0.5], [2, -7.5]];
const SLOT_COUNT: Record<string, number> = { lounge: 6, pantry: 6, musholla: 2, meeting: 6 };
const ACTIVITY: Record<string, string> = {
  lounge: "santai", pantry: "ngopi", musholla: "rehat", meeting: "mampir", node: "jalan",
};

interface RoamEntry {
  spot: string;
  slot: number;
  until: number;
}

function rollSpot(): string {
  const r = Math.random();
  if (r < 0.45) return "desk";
  if (r < 0.6) return "lounge";
  if (r < 0.75) return "pantry";
  if (r < 0.83) return "musholla";
  if (r < 0.9) return "meeting";
  return "node";
}

/* ------------------------- walking avatars ------------------------- */
/* Seat origin = chair. Sitter faces the desk (-z local). Avatar lives in a
   Walker (below), NOT in the seat — so it can stroll to meeting/lounge/pantry.
   Corridor routing lives in lib/office-graph.ts (tested pure module). */

const VIEWS: Record<string, { label: string; short: string; pos: [number, number, number]; tgt: [number, number, number] }> = {
  iso: { label: "tampak isometrik", short: "ISO", pos: [13, 13, 15], tgt: [0, 1, -0.5] },
  atas: { label: "tampak atas", short: "ATAS", pos: [0, 24, 1.5], tgt: [0, 0, 0.5] },
  meja: { label: "dekat tim", short: "TIM", pos: [-8, 3.5, 8.5], tgt: [-8, 1, -1] },
  rapat: { label: "ruang meeting", short: "RAPAT", pos: [9, 3.5, 2.5], tgt: [9, 1.2, -4.5] },
};
type ViewKey = keyof typeof VIEWS;

function CameraRig({ view }: { view: ViewKey }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  useEffect(() => {
    camera.position.set(...VIEWS[view].pos);
    controls?.target.set(...VIEWS[view].tgt);
    controls?.update();
  }, [view, camera, controls]);
  return null;
}

function Scene({ divisions, selected, onSelect, night, next, roam }: {
  divisions: DivisionStatus[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  night: boolean;
  next: Array<{ division: string; wake: string }>;
  roam: Record<string, RoamEntry>;
}) {
  const pods: Array<Array<DivisionStatus | null>> = [];
  const order: string[] = [];
  for (const g of POD_GROUPS) {
    const members = g.divisions.flatMap((div) => divisions.filter((d) => d.division === div));
    order.push(...members.map((m) => m.id));
    const chunk: Array<DivisionStatus | null> = [...members];
    while (chunk.length < 4) chunk.push(null);
    pods.push(chunk);
  }
  if (pods.length === 0) pods.push([null, null, null, null]);

  const nameOf = (id: string) => divisions.find((d) => d.id === id)?.name ?? id;
  const board: NightBoard = {
    woken: divisions.filter((d) => d.lastRun).length,
    pending: divisions.reduce((a, d) => a + d.pending, 0),
    done: divisions.filter((d) => d.state === "done").length,
    next: next[0] ? `${nameOf(next[0].division)} ${next[0].wake}` : "—",
  };
  const live = divisions.find((d) => d.state === "working") ?? divisions.find((d) => d.state === "needs_you") ?? null;

  return (
    <>
      <color attach="background" args={[night ? "#0b0e16" : "#a8c4de"]} />
      <fog attach="fog" args={[night ? "#0b0e16" : "#a8c4de", 30, 70]} />
      <ambientLight intensity={night ? 0.35 : 0.75} />
      {!night && <directionalLight position={[8, 12, 6]} intensity={1.1} />}

      {/* dark slate floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[38, 24]} />
        <meshStandardMaterial color={night ? "#232a33" : "#5a626c"} />
      </mesh>
      {/* workspace rug under the pod grid (3 cols x 2 rows) */}
      <mesh rotation-x={-Math.PI / 2} position={[-5, 0.012, -0.25]}>
        <planeGeometry args={[19, 10.5]} />
        <meshStandardMaterial color="#2f3b52" />
      </mesh>
      {/* amber zone strips */}
      <Strip from={[-14.5, -5.5]} to={[4.5, -5.5]} />
      <Strip from={[-14.5, 5]} to={[4.5, 5]} />
      <Strip from={[-14.5, -5.5]} to={[-14.5, 5]} />
      <Strip from={[4.5, -5.5]} to={[4.5, 5]} />
      <Strip from={[4.5, -0.8]} to={[13.5, -0.8]} />
      <Strip from={[4.5, 1.2]} to={[13, 1.2]} />

      {/* walls */}
      <mesh position={[0, 3, -9]}>
        <planeGeometry args={[38, 6]} />
        <meshStandardMaterial color={night ? "#1d232e" : "#d8cfc0"} />
      </mesh>
      <mesh rotation-y={Math.PI / 2} position={[-18, 3, 0]}>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial color={night ? "#1b212c" : "#d0c6b4"} />
      </mesh>
      <mesh rotation-y={-Math.PI / 2} position={[18, 3, 0]}>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial color={night ? "#1b212c" : "#d0c6b4"} />
      </mesh>
      {/* windows */}
      {[-6, 2].map((x) => (
        <mesh key={x} position={[x, 3.4, -8.97]}>
          <planeGeometry args={[4.4, 2.6]} />
          <meshStandardMaterial color="#0a1230" emissive={night ? "#27407a" : "#9fc0e8"} emissiveIntensity={night ? 0.7 : 0.4} />
        </mesh>
      ))}
      <Html position={[-11, 4.2, -8.9]} center distanceFactor={16} style={{ pointerEvents: "none" }}>
        <div style={{ color: "#e8ddc4", fontSize: 22, fontWeight: 800, letterSpacing: 4, opacity: 0.9 }}>KANTOR AI 🌙</div>
      </Html>
      {/* baseboard + house rules on the back wall */}
      <mesh position={[0, 0.15, -8.9]}>
        <boxGeometry args={[38, 0.3, 0.12]} />
        <meshStandardMaterial color="#10131a" />
      </mesh>
      {[[-3.4, "angka dari skrip,", "bukan kira-kira 📐"], [0.4, "kerja lembur,", "tidur nyenyak 🌙"]].map(([x, l1, l2]) => (
        <group key={x as number}>
          <mesh position={[x as number, 3.1, -8.93]}>
            <boxGeometry args={[3.4, 1.6, 0.08]} />
            <meshStandardMaterial color="#d8cfc0" />
          </mesh>
          <Html position={[x as number, 3.1, -8.85]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
            <div style={{ color: "#1d2133", fontSize: 13, fontWeight: 700, textAlign: "center", lineHeight: 1.6, whiteSpace: "nowrap" }}>
              {l1}<br />{l2}
            </div>
          </Html>
        </group>
      ))}
      {/* welcome mat at the open front */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 10.8]}>
        <planeGeometry args={[3, 1.4]} />
        <meshStandardMaterial color="#5a2e2e" />
      </mesh>
      <Html position={[0, 0.15, 10.8]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
        <div style={{ color: "#e8ddc4", fontSize: 12, fontWeight: 700, letterSpacing: 3 }}>SELAMAT LEMBUR</div>
      </Html>

      <TrackLights />
      {/* warm pendant drops over the pod columns */}
      {[[-12, -0.25], [-5, -0.25], [2, -0.25]].map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 4.6, z]}>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 1.4, 8]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <coneGeometry args={[0.4, 0.35, 18, 1, true]} />
            <meshStandardMaterial color="#274038" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -0.3, 0]}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshBasicMaterial color="#ffd9a0" />
          </mesh>
          {/* visible light cone (fake volumetric, additive) */}
          <mesh position={[0, -1.9, 0]}>
            <coneGeometry args={[1.5, 3.2, 20, 1, true]} />
            <meshBasicMaterial color="#ffbe78" transparent opacity={0.045} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <pointLight position={[0, -0.5, 0]} color="#ffbe78" intensity={10} distance={9} decay={2} />
        </group>
      ))}

      {/* workstation pods: one per team (small divisions share) */}
      {pods.map((members, i) => {
        const px = POD_POS[i % POD_POS.length][0];
        const pz = POD_POS[i % POD_POS.length][1];
        const label = POD_GROUPS[i % POD_GROUPS.length].label;
        return (
          <Pod key={label} members={members} position={[px, 0, pz]} selected={selected} onSelect={onSelect} label={label} />
        );
      })}

      {/* walking avatars: corridor-routed, never through furniture */}
      {divisions.map((d) => {
        let goal: [number, number];
        let entry: string | null;
        let activity: string | null = null;
        let face: number = 0;
        const r = d.place === "desk" ? roam[d.id] : undefined;
        const spot = r && r.until > Date.now() ? r.spot : "desk";
        if (spot === "desk") {
          let found: { pos: [number, number, number]; rot: number } = { pos: [0, 0, 0], rot: 0 };
          pods.forEach((members, pi) => {
            members.forEach((m, si) => {
              if (m && m.id === d.id) {
                const px = POD_POS[pi % POD_POS.length][0];
                const pz = POD_POS[pi % POD_POS.length][1];
                found = seatWorld(px, pz, si);
              }
            });
          });
          goal = [found.pos[0], found.pos[2]];
          entry = nearestNode(goal[0], goal[1]);
          face = found.rot;
        } else if (spot === "node") {
          const n = NODES[(r?.slot ?? 0) % NODES.length];
          goal = [n[0], n[1]];
          entry = null;
          activity = ACTIVITY.node;
        } else {
          const a = placeAnchor({ ...d, place: spot }, r?.slot ?? 0);
          goal = [a.pos[0], a.pos[2]];
          entry = spot === "meeting" ? "E0" : spot === "pantry" ? "E1" : spot === "lounge" ? "S0" : spot === "musholla" ? "M0" : null;
          activity = ACTIVITY[spot] ?? spot;
          face = a.rot;
        }
        return (
          <Walker key={d.id} d={d} route={planRoute(d.id, goal, entry)} rotY={face} selected={selected === d.id} onSelect={() => onSelect(d.id)} activity={activity} />
        );
      })}

      {/* zones — separated with walkway gaps, no overlaps */}
      <MeetingRoom position={[9, 0, -4.5]} board={board} />
      <Lounge position={[3, 0, 6.5]} liveName={live?.name ?? null} nextLabel={board.next} />
      <group position={[15.5, 0, -1]} rotation-y={-Math.PI / 2}>
        <Pantry position={[0, 0, 0]} />
      </group>
      <Musholla position={[15.5, 0, 4.8]} />

      {/* owner glass office (front-left corner) — your personal room */}
      <group position={[-15, 0, 7.6]}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
          <planeGeometry args={[4.4, 4.4]} />
          <meshStandardMaterial color="#3a2c33" />
        </mesh>
        {/* glass walls (east + north, open toward the floor) */}
        <mesh position={[2, 1.3, 0]}>
          <boxGeometry args={[0.08, 2.6, 4.4]} />
          <meshStandardMaterial color="#9fc0e8" transparent opacity={0.13} />
        </mesh>
        <mesh position={[2, 2.65, 0]}>
          <boxGeometry args={[0.12, 0.1, 4.4]} />
          <meshStandardMaterial color="#2c343d" />
        </mesh>
        <mesh position={[0, 1.3, -2.2]}>
          <boxGeometry args={[4.2, 2.6, 0.08]} />
          <meshStandardMaterial color="#9fc0e8" transparent opacity={0.13} />
        </mesh>
        <mesh position={[0, 2.65, -2.2]}>
          <boxGeometry args={[4.2, 0.1, 0.12]} />
          <meshStandardMaterial color="#2c343d" />
        </mesh>
        <mesh position={[0, 0.78, 0]}>
          <boxGeometry args={[1.9, 0.1, 0.95]} />
          <meshStandardMaterial color="#5a3d26" />
        </mesh>
        <Chair position={[0, 0, 0.95]} color="#2c2318" />
        <group position={[0, 0, 0.95]}>
          <Avatar color="#d8a93f" dim={false} walking={false} />
        </group>
        <Html position={[0, 2.1, 0]} center distanceFactor={12} style={{ pointerEvents: "none" }}>
          <div style={{ background: "rgba(10,12,16,0.85)", border: "1px solid #d8a93f", borderRadius: 8, padding: "3px 10px", fontSize: 12, color: "#eee", whiteSpace: "nowrap" }}>
            👑 <strong>Owner</strong> <span style={{ opacity: 0.65 }}>kamu · ruang kaca</span>
          </div>
        </Html>
      </group>
      <ServerRack position={[-16, 0, -2.8]} />
      <Plant position={[-16.5, 0, 1.5]} scale={1.2} />
      {/* green buffer on the open plaza */}
      <Plant position={[-2, 0, 10]} scale={1.1} />
      <Plant position={[13.5, 0, 9.8]} scale={0.9} />
      <Plant position={[-4, 0, -8]} scale={0.9} />

      <ContactShadows position={[0, 0.01, 0]} opacity={0.5} scale={38} blur={2.4} far={4} />
      <OrbitControls makeDefault target={[0, 1, -0.5]} maxPolarAngle={1.38} minDistance={4} maxDistance={38} />
    </>
  );
}

export default function OfficeView() {
  const [divisions, setDivisions] = useState<DivisionStatus[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [next, setNext] = useState<Array<{ division: string; wake: string }>>([]);
  const [clock, setClock] = useState("");
  const [isFs, setIsFs] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lightMode, setLightMode] = useState<"auto" | "day" | "night">("auto");
  const [view, setView] = useState<ViewKey>("iso");
  const [roam, setRoam] = useState<Record<string, RoamEntry>>({});
  const divRef = useRef<DivisionStatus[]>([]);
  divRef.current = divisions;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/status");
        const data = await res.json();
        if (alive) {
          setDivisions(data.divisions ?? []);
          setNext(data.next ?? []);
          setLoaded(true);
          setClock(
            new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          );
        }
      } catch { /* keep last */ }
    };
    load();
    const t = setInterval(load, 10000);
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    // ambient life director (paused for reduced-motion users)
    let roamTimer: ReturnType<typeof setInterval> | undefined;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      roamTimer = setInterval(() => {
        setRoam((prev) => {
          const now = Date.now();
          const next: Record<string, RoamEntry> = {};
          const taken: Record<string, Set<number>> = {};
          const take = (spot: string, slot: number) => {
            (taken[spot] ??= new Set()).add(slot);
          };
          for (const d of divRef.current) {
            if (d.place !== "desk") {
              const idx = divRef.current.filter((x) => x.place === d.place).findIndex((x) => x.id === d.id);
              take(d.place, Math.max(0, idx));
            }
          }
          for (const d of divRef.current) {
            if (d.place !== "desk" || (d.state !== "asleep" && d.state !== "done")) continue;
            const cur = prev[d.id];
            // Keep only if the stool is STILL free — a summoned member may have
            // taken this index since the last roll. Otherwise re-roll below.
            if (cur && cur.until > now && (cur.spot === "desk" || !taken[cur.spot]?.has(cur.slot))) {
              next[d.id] = cur;
              take(cur.spot, cur.slot);
              continue;
            }
            const spot = rollSpot();
            if (spot === "desk") {
              next[d.id] = { spot, slot: 0, until: now + 20000 + Math.random() * 20000 };
              continue;
            }
            const cap = spot === "node" ? NODES.length : (SLOT_COUNT[spot] ?? 4);
            let slot = -1;
            for (let s = 0; s < cap; s++) {
              if (!taken[spot]?.has(s)) { slot = s; break; }
            }
            if (slot === -1) {
              next[d.id] = { spot: "desk", slot: 0, until: now + 20000 };
              continue;
            }
            take(spot, slot);
            next[d.id] = { spot, slot, until: now + 25000 + Math.random() * 35000 };
          }
          return next;
        });
      }, 4000);
    }
    return () => { alive = false; clearInterval(t); if (roamTimer) clearInterval(roamTimer); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  const hourWib = (Date.now() / 3600000 + 7) % 24;
  const autoNight = hourWib >= 18 || hourWib < 6;
  const night = lightMode === "night" || (lightMode === "auto" && autoNight);
  const sel = divisions.find((d) => d.id === selected) ?? null;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#090a0f" }}>
      {!loaded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, zIndex: 60 }}>
          <img src="/img/agent-bot.png" alt="menyalakan kantor" style={{ width: 280, borderRadius: 16, boxShadow: "0 0 60px rgba(0,240,255,0.15)" }} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: 2, color: "#00f0ff" }}><Mark size={14} /> MENYALAKAN KANTOR…</div>
        </div>
      )}
      <Canvas camera={{ position: [13, 13, 15], fov: 48 }} onPointerMissed={() => setSelected(null)}>
        <Suspense fallback={null}>
          <CameraRig view={view} />
          <Scene divisions={divisions} selected={selected} onSelect={setSelected} night={night} next={next} roam={roam} />
        </Suspense>
      </Canvas>
      <div style={{ position: "absolute", top: 14, left: 16, right: 16, display: "flex", alignItems: "center", gap: 12, pointerEvents: "none" }}>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 2, color: "#e8ddc4", textShadow: "0 2px 8px #000" }}>
          <Mark size={18} /> KANTOR AI
        </span>
        <span style={{ fontSize: 12, color: "#8a8f98", background: "rgba(10,12,16,0.85)", padding: "4px 10px", borderRadius: 999 }}>
          {clock} WIB · {divisions.filter((d) => d.state === "working").length} lembur · {divisions.reduce((a, d) => a + d.pending, 0)} butuh kamu{next[0] ? ` · berikutnya: ${next[0].division} ${next[0].wake}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", gap: 4, background: "rgba(10,12,16,0.85)", border: "1px solid #333", borderRadius: 8, padding: 3, pointerEvents: "auto" }}>
          {(Object.keys(VIEWS) as ViewKey[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              title={VIEWS[v].label}
              style={{
                margin: 0, padding: "3px 9px", fontSize: 11, fontWeight: 700, letterSpacing: 1,
                background: view === v ? "#00f0ff" : "transparent",
                color: view === v ? "#090a0f" : "#aaa",
                border: 0, borderRadius: 5, minHeight: 0,
              }}
            >
              {VIEWS[v].short}
            </button>
          ))}
        </span>
        <span style={{ display: "flex", gap: 4, background: "rgba(10,12,16,0.85)", border: "1px solid #333", borderRadius: 8, padding: 3, pointerEvents: "auto" }}>
          {(["auto", "day", "night"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setLightMode(m)}
              title={m === "auto" ? "ikut jam Jakarta" : m === "day" ? "preview siang" : "preview malam"}
              style={{
                margin: 0,
                padding: "3px 9px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                background: lightMode === m ? "#00f0ff" : "transparent",
                color: lightMode === m ? "#090a0f" : "#aaa",
                border: 0,
                borderRadius: 5,
                minHeight: 0,
              }}
            >
              {m === "auto" ? "AUTO" : m === "day" ? "SIANG" : "MALAM"}
            </button>
          ))}
        </span>
        <button onClick={toggleFs} style={{ pointerEvents: "auto", background: "rgba(10,12,16,0.85)", border: "1px solid #333", margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1, minHeight: 0, padding: "6px 12px" }}>
          {isFs ? "KELUAR" : "PENUH"}
        </button>
      </div>
      <div style={{ position: "absolute", bottom: 14, left: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(Object.keys(STATE_COLOR) as DivisionStatus["state"][]).map((s) => (
          <span key={s} style={{ fontSize: 12, background: "rgba(10,12,16,0.8)", padding: "2px 10px", borderRadius: 999, color: "#ddd" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: STATE_COLOR[s], marginRight: 6 }} />
            {STATE_LABEL[s]}
          </span>
        ))}
        <span style={{ fontSize: 12, color: "#8a8f98", padding: "2px 4px" }}>seret = putar · scroll = zoom · klik meja = intip</span>
      </div>
      {sel && (
        <div style={{ position: "absolute", top: 0, right: 0, width: 300, height: "100%", background: "rgba(14,17,22,0.96)", borderLeft: "1px solid #2c343d", padding: 16, overflowY: "auto" }}>
          <button onClick={() => setSelected(null)} style={{ float: "right", background: "#2c343d" }}>✕</button>
          <h3 style={{ marginTop: 0 }}>{sel.name} <small>· {sel.role}</small></h3>
          <p><span className="badge" style={{ background: STATE_COLOR[sel.state] }}>{STATE_LABEL[sel.state]}</span>
            {sel.pending > 0 && <span className="badge needs">{sel.pending} menunggu kamu</span>}</p>
          <h4>Hasil malam ini</h4>
          {sel.hasilFiles.length === 0 ? <p><small>Belum ada file.</small></p> : <ul>{sel.hasilFiles.map((f) => <li key={f}><small>{f}</small></li>)}</ul>}
          <h4>Run terakhir</h4>
          <p><small>{sel.lastRun ? `${sel.lastRun.status} · ${new Date(sel.lastRun.started_at).toLocaleString("id-ID")}` : "belum pernah bangun"}</small></p>
          {sel.lastRun?.summary && <pre>{sel.lastRun.summary}</pre>}
          <p><button onClick={() => window.dispatchEvent(new CustomEvent("kantor:tab", { detail: "dashboard" }))} style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>Lihat di panel dashboard →</button></p>
        </div>
      )}
    </div>
  );
}
