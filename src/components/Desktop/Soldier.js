import * as THREE from 'three';

const TAU = Math.PI * 2;
const DEFAULT_FADE_SECONDS = 0.18;
const WALK_STATE_THRESHOLD = 0.08;
const RUN_STATE_THRESHOLD = 0.74;

export const SOLDIER_HIT_ANIMATION_MS = 360;
export const SOLDIER_DEATH_ANIMATION_MS = 980;

const SHARED_PISTOL_GEOMETRIES = {
  slide: new THREE.BoxGeometry(0.34, 0.18, 0.92),
  frame: new THREE.BoxGeometry(0.28, 0.2, 0.68),
  grip: new THREE.BoxGeometry(0.2, 0.42, 0.24),
  barrel: new THREE.CylinderGeometry(0.04, 0.04, 0.44, 8),
  sight: new THREE.BoxGeometry(0.08, 0.04, 0.08)
};

const SHARED_PISTOL_MATERIALS = {
  dark: new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.48, metalness: 0.42 }),
  accent: new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.56, metalness: 0.26 }),
  grip: new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 0.84, metalness: 0.08 })
};

const poseOffset = (position = null, rotation = null, scale = null) => ({ position, rotation, scale });

const buildPoseFrames = (frames = []) => frames.map((frame) => ({
  time: frame.time,
  pose: frame.pose || {}
}));

export const getSoldierWeaponAnimationProfile = (weaponType = 'rifleman') => {
  const normalized = weaponType === 'pistol' || weaponType === 'sidearm'
    ? 'pistol'
    : weaponType;

  return SOLDIER_WEAPON_ANIMATION_PROFILES[normalized] || SOLDIER_WEAPON_ANIMATION_PROFILES.rifleman;
};

const SOLDIER_WEAPON_ANIMATION_PROFILES = {
  rifleman: {
    weaponClass: 'rifle',
    aimClip: 'aim-rifle',
    fireClip: 'fire-rifle',
    reloadClip: 'reload-rifle',
    magazineSize: 24,
    shotWindupMs: 96,
    fireAnimationMs: 320,
    reloadDurationMs: 1280,
    muzzleFlashDurationMs: 80,
    minimumShotIntervalMs: 140,
    recoilAmount: 0.52,
    aimSettleMs: 150,
    aimAlignmentThreshold: 0.13,
    fireMoveRatio: 0.42
  },
  marksman: {
    weaponClass: 'rifle',
    aimClip: 'aim-rifle',
    fireClip: 'fire-rifle',
    reloadClip: 'reload-rifle',
    magazineSize: 8,
    shotWindupMs: 126,
    fireAnimationMs: 420,
    reloadDurationMs: 1560,
    muzzleFlashDurationMs: 110,
    minimumShotIntervalMs: 280,
    recoilAmount: 0.64,
    aimSettleMs: 210,
    aimAlignmentThreshold: 0.1,
    fireMoveRatio: 0.28
  },
  gunner: {
    weaponClass: 'rifle',
    aimClip: 'aim-rifle',
    fireClip: 'fire-rifle',
    reloadClip: 'reload-rifle',
    magazineSize: 36,
    shotWindupMs: 74,
    fireAnimationMs: 240,
    reloadDurationMs: 1720,
    muzzleFlashDurationMs: 70,
    minimumShotIntervalMs: 92,
    recoilAmount: 0.38,
    aimSettleMs: 120,
    aimAlignmentThreshold: 0.16,
    fireMoveRatio: 0.5
  },
  rpg: {
    weaponClass: 'launcher',
    aimClip: 'aim-launcher',
    fireClip: 'fire-launcher',
    reloadClip: 'reload-launcher',
    magazineSize: 1,
    shotWindupMs: 188,
    fireAnimationMs: 620,
    reloadDurationMs: 2150,
    muzzleFlashDurationMs: 140,
    minimumShotIntervalMs: 520,
    recoilAmount: 0.82,
    aimSettleMs: 260,
    aimAlignmentThreshold: 0.1,
    fireMoveRatio: 0.2
  },
  missile: {
    weaponClass: 'launcher',
    aimClip: 'aim-launcher',
    fireClip: 'fire-launcher',
    reloadClip: 'reload-launcher',
    magazineSize: 1,
    shotWindupMs: 228,
    fireAnimationMs: 760,
    reloadDurationMs: 2520,
    muzzleFlashDurationMs: 165,
    minimumShotIntervalMs: 760,
    recoilAmount: 0.9,
    aimSettleMs: 320,
    aimAlignmentThreshold: 0.09,
    fireMoveRatio: 0.16
  },
  engineer: {
    weaponClass: 'tool',
    aimClip: 'aim-tool',
    fireClip: 'fire-tool',
    reloadClip: 'reload-tool',
    magazineSize: 10,
    shotWindupMs: 108,
    fireAnimationMs: 280,
    reloadDurationMs: 1120,
    muzzleFlashDurationMs: 70,
    minimumShotIntervalMs: 220,
    recoilAmount: 0.22,
    aimSettleMs: 140,
    aimAlignmentThreshold: 0.14,
    fireMoveRatio: 0.38
  },
  pistol: {
    weaponClass: 'pistol',
    aimClip: 'aim-pistol',
    fireClip: 'fire-pistol',
    reloadClip: 'reload-pistol',
    magazineSize: 12,
    shotWindupMs: 82,
    fireAnimationMs: 250,
    reloadDurationMs: 980,
    muzzleFlashDurationMs: 72,
    minimumShotIntervalMs: 120,
    recoilAmount: 0.3,
    aimSettleMs: 95,
    aimAlignmentThreshold: 0.18,
    fireMoveRatio: 0.58
  }
};

const findNodeByPrefix = (object, prefix) => {
  if (!object || !prefix) return null;
  const namedNodes = object.userData?.namedNodes || {};
  if (namedNodes[prefix]) return namedNodes[prefix];
  const entry = Object.entries(namedNodes).find(([name]) => name === prefix || name.startsWith(`${prefix}_`));
  return entry?.[1] || null;
};

const snapshotTransform = (node) => {
  if (!node) return null;
  return {
    position: node.position.clone(),
    rotation: node.rotation.clone(),
    scale: node.scale.clone()
  };
};

const makeRigPart = (root, prefix, logicalKey = prefix) => {
  const node = findNodeByPrefix(root, prefix);
  if (!node) return null;
  return {
    key: logicalKey,
    node,
    name: node.name,
    base: snapshotTransform(node)
  };
};

const buildSoldierRig = (root) => ({
  torso: makeRigPart(root, 'unit_torso', 'torso'),
  vest: makeRigPart(root, 'unit_vest', 'vest'),
  pack: makeRigPart(root, 'unit_pack', 'pack'),
  belt: makeRigPart(root, 'unit_belt', 'belt'),
  head: makeRigPart(root, 'unit_head', 'head'),
  helmet: makeRigPart(root, 'unit_helmet', 'helmet'),
  visor: makeRigPart(root, 'unit_visor', 'visor'),
  neckWrap: makeRigPart(root, 'unit_neck_wrap', 'neckWrap'),
  legLeft: makeRigPart(root, 'unit_leg_left', 'legLeft'),
  legRight: makeRigPart(root, 'unit_leg_right', 'legRight'),
  bootLeft: makeRigPart(root, 'unit_boot_left', 'bootLeft'),
  bootRight: makeRigPart(root, 'unit_boot_right', 'bootRight'),
  armLeft: makeRigPart(root, 'unit_arm_left', 'armLeft'),
  armRight: makeRigPart(root, 'unit_arm_right', 'armRight'),
  padLeft: makeRigPart(root, 'unit_pad_left', 'padLeft'),
  padRight: makeRigPart(root, 'unit_pad_right', 'padRight'),
  weapon: makeRigPart(root, 'unit_weapon', 'weapon'),
  tool: makeRigPart(root, 'unit_tool', 'tool'),
  toolCanister: makeRigPart(root, 'unit_tool_canister', 'toolCanister'),
  torch: makeRigPart(root, 'unit_torch', 'torch'),
  weaponMuzzle: makeRigPart(root, 'weapon_muzzle', 'weaponMuzzle'),
  launcherProbe: makeRigPart(root, 'weapon_probe', 'launcherProbe'),
  toolNozzle: makeRigPart(root, 'weapon_nozzle_tip', 'toolNozzle')
});

const enumerateRigParts = (rig) => Object.values(rig).filter((part) => part?.node && part?.base);

const appendTrackSample = (bucket, time, value) => {
  if (!bucket.times.length || Math.abs(bucket.times[bucket.times.length - 1] - time) > 1e-6) {
    bucket.times.push(time);
    bucket.values.push(value);
    return;
  }

  bucket.values[bucket.values.length - 1] = value;
};

const buildClipFromFrames = (name, rig, frames = [], duration, { loop = true } = {}) => {
  const tracks = [];
  const rigParts = enumerateRigParts(rig);

  rigParts.forEach((part) => {
    const nodeName = part.name;
    const positionTracks = { x: { times: [], values: [] }, y: { times: [], values: [] }, z: { times: [], values: [] } };
    const rotationTracks = { x: { times: [], values: [] }, y: { times: [], values: [] }, z: { times: [], values: [] } };
    const scaleTracks = { x: { times: [], values: [] }, y: { times: [], values: [] }, z: { times: [], values: [] } };
    let touched = false;

    frames.forEach((frame) => {
      const transform = frame.pose?.[part.key] || frame.pose?.[nodeName];
      if (!transform) return;
      touched = true;

      ['x', 'y', 'z'].forEach((axis) => {
        const positionOffset = transform.position?.[axis];
        if (positionOffset !== undefined) {
          appendTrackSample(positionTracks[axis], frame.time, part.base.position[axis] + positionOffset);
        }

        const rotationOffset = transform.rotation?.[axis];
        if (rotationOffset !== undefined) {
          appendTrackSample(rotationTracks[axis], frame.time, part.base.rotation[axis] + rotationOffset);
        }

        const scaleOffset = transform.scale?.[axis];
        if (scaleOffset !== undefined) {
          appendTrackSample(scaleTracks[axis], frame.time, part.base.scale[axis] * scaleOffset);
        }
      });
    });

    if (!touched) return;

    ['x', 'y', 'z'].forEach((axis) => {
      const positionTrack = positionTracks[axis];
      if (positionTrack.times.length) {
        tracks.push(new THREE.NumberKeyframeTrack(`${nodeName}.position[${axis}]`, positionTrack.times, positionTrack.values));
      }

      const rotationTrack = rotationTracks[axis];
      if (rotationTrack.times.length) {
        tracks.push(new THREE.NumberKeyframeTrack(`${nodeName}.rotation[${axis}]`, rotationTrack.times, rotationTrack.values));
      }

      const scaleTrack = scaleTracks[axis];
      if (scaleTrack.times.length) {
        tracks.push(new THREE.NumberKeyframeTrack(`${nodeName}.scale[${axis}]`, scaleTrack.times, scaleTrack.values));
      }
    });
  });

  const clip = new THREE.AnimationClip(name, duration, tracks);
  clip.userData = { loop };
  return clip.optimize();
};

const getAimPoseByClass = (weaponClass = 'rifle') => {
  if (weaponClass === 'launcher') {
    return {
      torso: poseOffset({ y: 0.28, z: -0.26 }, { x: -0.18, z: 0.02 }),
      vest: poseOffset({ y: 0.22 }, { x: -0.1 }),
      pack: poseOffset({ y: 0.18, z: -0.18 }, { x: 0.06 }),
      armLeft: poseOffset({ y: 0.12 }, { x: -1.06, y: 0.22, z: 0.54 }),
      armRight: poseOffset({ y: 0.08 }, { x: -1.04, y: -0.14, z: -0.34 }),
      padLeft: poseOffset({ y: 0.1 }, { x: -0.58, z: 0.42 }),
      padRight: poseOffset({ y: 0.08 }, { x: -0.56, z: -0.28 }),
      head: poseOffset({ y: 0.12 }, { x: 0.04 }),
      helmet: poseOffset({ y: 0.1 }, { x: 0.03 }),
      weapon: poseOffset({ x: -2.3, y: 5.2, z: -1.55 }, { x: -0.2, y: 0.02, z: 1.14 })
    };
  }

  if (weaponClass === 'tool') {
    return {
      torso: poseOffset({ y: 0.18, z: -0.16 }, { x: -0.12 }),
      vest: poseOffset({ y: 0.14 }, { x: -0.06 }),
      armLeft: poseOffset({ y: 0.08 }, { x: -0.88, y: 0.14, z: 0.24 }),
      armRight: poseOffset({ y: 0.06 }, { x: -0.96, y: -0.06, z: -0.18 }),
      padLeft: poseOffset({ y: 0.07 }, { x: -0.42, z: 0.18 }),
      padRight: poseOffset({ y: 0.06 }, { x: -0.46, z: -0.14 }),
      head: poseOffset({ y: 0.08 }, { x: 0.03 }),
      tool: poseOffset({ x: -2.28, y: 3.9, z: -0.9 }, { x: -0.12, y: 0.06, z: 1.14 }),
      torch: poseOffset({ y: 0.16, z: 0.16 }, { x: -0.16, z: -0.18 }),
      toolCanister: poseOffset({ y: 0.12 }, { z: -0.04 })
    };
  }

  if (weaponClass === 'pistol') {
    return {
      torso: poseOffset({ y: 0.2, z: -0.16 }, { x: -0.12 }),
      vest: poseOffset({ y: 0.14 }, { x: -0.06 }),
      armLeft: poseOffset({ y: 0.04 }, { x: -0.34, y: 0.12, z: 0.14 }),
      armRight: poseOffset({ y: 0.08 }, { x: -1.18, y: -0.04, z: -0.12 }),
      padLeft: poseOffset({ y: 0.04 }, { x: -0.16, z: 0.12 }),
      padRight: poseOffset({ y: 0.06 }, { x: -0.54, z: -0.12 }),
      head: poseOffset({ y: 0.08 }, { x: 0.03 }),
      weapon: poseOffset({ x: -0.82, y: 1.62, z: 0.68 }, { x: 0.06, y: 0.02, z: 0.28 })
    };
  }

  return {
    torso: poseOffset({ y: 0.24, z: -0.18 }, { x: -0.14 }),
    vest: poseOffset({ y: 0.18 }, { x: -0.08 }),
    pack: poseOffset({ y: 0.12, z: -0.12 }, { x: 0.04 }),
    armLeft: poseOffset({ y: 0.08 }, { x: -1.02, y: 0.18, z: 0.4 }),
    armRight: poseOffset({ y: 0.08 }, { x: -1.08, y: -0.08, z: -0.28 }),
    padLeft: poseOffset({ y: 0.06 }, { x: -0.56, z: 0.28 }),
    padRight: poseOffset({ y: 0.06 }, { x: -0.56, z: -0.22 }),
    head: poseOffset({ y: 0.08 }, { x: 0.03 }),
    helmet: poseOffset({ y: 0.06 }, { x: 0.03 }),
    weapon: poseOffset({ x: -2.72, y: 4.28, z: -1.08 }, { x: -0.12, y: 0.08, z: 1.22 })
  };
};

const mergePoseObjects = (...poses) => {
  const merged = {};
  poses.filter(Boolean).forEach((pose) => {
    Object.entries(pose).forEach(([partKey, value]) => {
      const current = merged[partKey] || {};
      merged[partKey] = {
        position: { ...(current.position || {}), ...(value.position || {}) },
        rotation: { ...(current.rotation || {}), ...(value.rotation || {}) },
        scale: { ...(current.scale || {}), ...(value.scale || {}) }
      };
    });
  });
  return merged;
};

const createAnimationLibrary = (rig) => {
  const clips = [];

  clips.push(buildClipFromFrames('idle', rig, buildPoseFrames([
    {
      time: 0,
      pose: {
        torso: poseOffset({ y: 0 }, { x: 0.02 }),
        vest: poseOffset({ y: 0 }, { x: 0.01 }),
        pack: poseOffset({ y: 0 }, { x: -0.01 }),
        head: poseOffset({ y: 0 }, { x: 0.01 }),
        helmet: poseOffset({ y: 0 }, { x: 0.01 }),
        armLeft: poseOffset(null, { x: -0.08, z: -0.04 }),
        armRight: poseOffset(null, { x: 0.08, z: 0.04 })
      }
    },
    {
      time: 0.75,
      pose: {
        torso: poseOffset({ y: 0.22 }, { x: 0.05 }),
        vest: poseOffset({ y: 0.14 }, { x: 0.03 }),
        pack: poseOffset({ y: 0.12 }, { x: -0.03 }),
        head: poseOffset({ y: 0.08 }, { x: 0.02 }),
        helmet: poseOffset({ y: 0.06 }, { x: 0.02 }),
        armLeft: poseOffset({ y: 0.02 }, { x: -0.12, z: -0.06 }),
        armRight: poseOffset({ y: 0.02 }, { x: 0.12, z: 0.06 })
      }
    },
    {
      time: 1.5,
      pose: {
        torso: poseOffset({ y: 0 }, { x: 0.02 }),
        vest: poseOffset({ y: 0 }, { x: 0.01 }),
        pack: poseOffset({ y: 0 }, { x: -0.01 }),
        head: poseOffset({ y: 0 }, { x: 0.01 }),
        helmet: poseOffset({ y: 0 }, { x: 0.01 }),
        armLeft: poseOffset(null, { x: -0.08, z: -0.04 }),
        armRight: poseOffset(null, { x: 0.08, z: 0.04 })
      }
    }
  ]), 1.5));

  clips.push(buildClipFromFrames('walk', rig, buildPoseFrames([
    {
      time: 0,
      pose: {
        torso: poseOffset({ y: 0.12, z: -0.1 }, { x: -0.03, z: 0.02 }),
        vest: poseOffset({ y: 0.08 }, { x: -0.02 }),
        head: poseOffset({ y: 0.05 }, { x: 0.02 }),
        legLeft: poseOffset({ y: 0.08, z: 0.18 }, { x: 0.54, z: -0.03 }),
        legRight: poseOffset({ y: 0, z: 0 }, { x: -0.54, z: 0.03 }),
        bootLeft: poseOffset({ y: 0.04 }, { x: -0.2 }),
        bootRight: poseOffset({ y: 0 }, { x: 0.2 }),
        armLeft: poseOffset({ y: 0.04 }, { x: -0.34, z: -0.08 }),
        armRight: poseOffset({ y: 0.02 }, { x: 0.32, z: 0.08 }),
        weapon: poseOffset({ y: 0.06, z: 0.08 }, { x: 0.04, z: -0.03 }),
        tool: poseOffset({ y: 0.06, z: 0.08 }, { x: 0.04, z: -0.03 })
      }
    },
    {
      time: 0.3,
      pose: {
        torso: poseOffset({ y: 0.28, z: -0.18 }, { x: -0.06 }),
        vest: poseOffset({ y: 0.18 }, { x: -0.03 }),
        pack: poseOffset({ y: 0.1 }, { x: 0.04 }),
        legLeft: poseOffset({ y: 0.02 }, { x: 0.08 }),
        legRight: poseOffset({ y: 0.1, z: 0.18 }, { x: -0.08 }),
        armLeft: poseOffset({ y: 0.06 }, { x: -0.06 }),
        armRight: poseOffset({ y: 0.06 }, { x: 0.06 }),
        weapon: poseOffset({ y: 0.08 }, { x: 0.02 }),
        tool: poseOffset({ y: 0.08 }, { x: 0.02 })
      }
    },
    {
      time: 0.6,
      pose: {
        torso: poseOffset({ y: 0.12, z: -0.1 }, { x: -0.03, z: -0.02 }),
        vest: poseOffset({ y: 0.08 }, { x: -0.02 }),
        head: poseOffset({ y: 0.05 }, { x: 0.02 }),
        legLeft: poseOffset({ y: 0, z: 0 }, { x: -0.54, z: 0.03 }),
        legRight: poseOffset({ y: 0.08, z: 0.18 }, { x: 0.54, z: -0.03 }),
        bootLeft: poseOffset({ y: 0 }, { x: 0.2 }),
        bootRight: poseOffset({ y: 0.04 }, { x: -0.2 }),
        armLeft: poseOffset({ y: 0.02 }, { x: 0.32, z: -0.08 }),
        armRight: poseOffset({ y: 0.04 }, { x: -0.34, z: 0.08 }),
        weapon: poseOffset({ y: 0.06, z: -0.08 }, { x: -0.04, z: 0.03 }),
        tool: poseOffset({ y: 0.06, z: -0.08 }, { x: -0.04, z: 0.03 })
      }
    },
    {
      time: 0.9,
      pose: {
        torso: poseOffset({ y: 0.28, z: -0.18 }, { x: -0.06 }),
        vest: poseOffset({ y: 0.18 }, { x: -0.03 }),
        pack: poseOffset({ y: 0.1 }, { x: 0.04 }),
        legLeft: poseOffset({ y: 0.1, z: 0.18 }, { x: -0.08 }),
        legRight: poseOffset({ y: 0.02 }, { x: 0.08 }),
        armLeft: poseOffset({ y: 0.06 }, { x: 0.02 }),
        armRight: poseOffset({ y: 0.06 }, { x: -0.02 }),
        weapon: poseOffset({ y: 0.08 }, { x: -0.02 }),
        tool: poseOffset({ y: 0.08 }, { x: -0.02 })
      }
    },
    {
      time: 1.2,
      pose: {
        torso: poseOffset({ y: 0.12, z: -0.1 }, { x: -0.03, z: 0.02 }),
        vest: poseOffset({ y: 0.08 }, { x: -0.02 }),
        head: poseOffset({ y: 0.05 }, { x: 0.02 }),
        legLeft: poseOffset({ y: 0.08, z: 0.18 }, { x: 0.54, z: -0.03 }),
        legRight: poseOffset({ y: 0, z: 0 }, { x: -0.54, z: 0.03 }),
        bootLeft: poseOffset({ y: 0.04 }, { x: -0.2 }),
        bootRight: poseOffset({ y: 0 }, { x: 0.2 }),
        armLeft: poseOffset({ y: 0.04 }, { x: -0.34, z: -0.08 }),
        armRight: poseOffset({ y: 0.02 }, { x: 0.32, z: 0.08 }),
        weapon: poseOffset({ y: 0.06, z: 0.08 }, { x: 0.04, z: -0.03 }),
        tool: poseOffset({ y: 0.06, z: 0.08 }, { x: 0.04, z: -0.03 })
      }
    }
  ]), 1.2));

  clips.push(buildClipFromFrames('run', rig, buildPoseFrames([
    {
      time: 0,
      pose: {
        torso: poseOffset({ y: 0.26, z: -0.3 }, { x: -0.18, z: 0.05 }),
        vest: poseOffset({ y: 0.18 }, { x: -0.1 }),
        pack: poseOffset({ y: 0.12, z: -0.1 }, { x: 0.08 }),
        head: poseOffset({ y: 0.08 }, { x: 0.06 }),
        legLeft: poseOffset({ y: 0.12, z: 0.3 }, { x: 0.94, z: -0.08 }),
        legRight: poseOffset({ y: 0, z: 0 }, { x: -0.88, z: 0.08 }),
        bootLeft: poseOffset({ y: 0.08 }, { x: -0.36 }),
        bootRight: poseOffset({ y: 0 }, { x: 0.34 }),
        armLeft: poseOffset({ y: 0.1 }, { x: -0.52, z: -0.14 }),
        armRight: poseOffset({ y: 0.08 }, { x: 0.58, z: 0.14 })
      }
    },
    {
      time: 0.22,
      pose: {
        torso: poseOffset({ y: 0.52, z: -0.4 }, { x: -0.22 }),
        vest: poseOffset({ y: 0.34 }, { x: -0.12 }),
        pack: poseOffset({ y: 0.2 }, { x: 0.12 }),
        legLeft: poseOffset({ y: 0.04 }, { x: 0.12 }),
        legRight: poseOffset({ y: 0.18, z: 0.3 }, { x: -0.12 }),
        armLeft: poseOffset({ y: 0.12 }, { x: -0.08 }),
        armRight: poseOffset({ y: 0.12 }, { x: 0.06 })
      }
    },
    {
      time: 0.44,
      pose: {
        torso: poseOffset({ y: 0.26, z: -0.3 }, { x: -0.18, z: -0.05 }),
        vest: poseOffset({ y: 0.18 }, { x: -0.1 }),
        pack: poseOffset({ y: 0.12, z: -0.1 }, { x: 0.08 }),
        head: poseOffset({ y: 0.08 }, { x: 0.06 }),
        legLeft: poseOffset({ y: 0, z: 0 }, { x: -0.88, z: 0.08 }),
        legRight: poseOffset({ y: 0.12, z: 0.3 }, { x: 0.94, z: -0.08 }),
        bootLeft: poseOffset({ y: 0 }, { x: 0.34 }),
        bootRight: poseOffset({ y: 0.08 }, { x: -0.36 }),
        armLeft: poseOffset({ y: 0.08 }, { x: 0.58, z: -0.14 }),
        armRight: poseOffset({ y: 0.1 }, { x: -0.52, z: 0.14 })
      }
    },
    {
      time: 0.66,
      pose: {
        torso: poseOffset({ y: 0.52, z: -0.4 }, { x: -0.22 }),
        vest: poseOffset({ y: 0.34 }, { x: -0.12 }),
        pack: poseOffset({ y: 0.2 }, { x: 0.12 }),
        legLeft: poseOffset({ y: 0.18, z: 0.3 }, { x: -0.12 }),
        legRight: poseOffset({ y: 0.04 }, { x: 0.12 }),
        armLeft: poseOffset({ y: 0.12 }, { x: 0.04 }),
        armRight: poseOffset({ y: 0.12 }, { x: -0.04 })
      }
    },
    {
      time: 0.88,
      pose: {
        torso: poseOffset({ y: 0.26, z: -0.3 }, { x: -0.18, z: 0.05 }),
        vest: poseOffset({ y: 0.18 }, { x: -0.1 }),
        pack: poseOffset({ y: 0.12, z: -0.1 }, { x: 0.08 }),
        head: poseOffset({ y: 0.08 }, { x: 0.06 }),
        legLeft: poseOffset({ y: 0.12, z: 0.3 }, { x: 0.94, z: -0.08 }),
        legRight: poseOffset({ y: 0, z: 0 }, { x: -0.88, z: 0.08 }),
        bootLeft: poseOffset({ y: 0.08 }, { x: -0.36 }),
        bootRight: poseOffset({ y: 0 }, { x: 0.34 }),
        armLeft: poseOffset({ y: 0.1 }, { x: -0.52, z: -0.14 }),
        armRight: poseOffset({ y: 0.08 }, { x: 0.58, z: 0.14 })
      }
    }
  ]), 0.88));

  ['rifle', 'pistol', 'launcher', 'tool'].forEach((weaponClass) => {
    const aimPose = getAimPoseByClass(weaponClass);
    clips.push(buildClipFromFrames(`aim-${weaponClass}`, rig, buildPoseFrames([
      { time: 0, pose: mergePoseObjects(aimPose, { torso: poseOffset({ y: 0.02 }, { x: 0.01 }), head: poseOffset({ y: 0.02 }, { x: 0.01 }) }) },
      { time: 0.65, pose: mergePoseObjects(aimPose, { torso: poseOffset({ y: 0.18 }, { x: 0.04 }), head: poseOffset({ y: 0.08 }, { x: 0.03 }), weapon: poseOffset({ z: 0.04 }, { x: 0.02 }) }) },
      { time: 1.3, pose: mergePoseObjects(aimPose, { torso: poseOffset({ y: 0.02 }, { x: 0.01 }), head: poseOffset({ y: 0.02 }, { x: 0.01 }) }) }
    ]), 1.3));
  });

  ['rifle', 'pistol', 'launcher', 'tool'].forEach((weaponClass) => {
    const aimPose = getAimPoseByClass(weaponClass);
    const recoilPose = weaponClass === 'launcher'
      ? {
          torso: poseOffset({ z: -0.42 }, { x: -0.28 }),
          head: poseOffset({ y: 0.04 }, { x: 0.18 }),
          armLeft: poseOffset(null, { x: -0.08 }),
          armRight: poseOffset(null, { x: 0.16 }),
          weapon: poseOffset({ z: -0.42 }, { x: 0.16, z: -0.08 }),
          tool: poseOffset({ z: -0.22 }, { x: 0.12, z: -0.08 }),
          torch: poseOffset({ z: -0.14 }, { x: 0.12 })
        }
      : weaponClass === 'pistol'
        ? {
            torso: poseOffset({ z: -0.24 }, { x: -0.18 }),
            head: poseOffset({ y: 0.04 }, { x: 0.12 }),
            armRight: poseOffset(null, { x: 0.22, z: -0.08 }),
            weapon: poseOffset({ z: -0.16 }, { x: 0.14, z: -0.04 })
          }
        : weaponClass === 'tool'
          ? {
              torso: poseOffset({ z: -0.14 }, { x: -0.14 }),
              head: poseOffset({ y: 0.03 }, { x: 0.08 }),
              armRight: poseOffset(null, { x: 0.12, z: -0.04 }),
              tool: poseOffset({ z: -0.12 }, { x: 0.1, z: -0.08 }),
              torch: poseOffset({ z: 0.08 }, { x: 0.08 })
            }
          : {
              torso: poseOffset({ z: -0.22 }, { x: -0.18 }),
              head: poseOffset({ y: 0.04 }, { x: 0.12 }),
              armLeft: poseOffset(null, { x: -0.06 }),
              armRight: poseOffset(null, { x: 0.14, z: -0.04 }),
              weapon: poseOffset({ z: -0.22 }, { x: 0.12, z: -0.06 })
            };

    clips.push(buildClipFromFrames(`fire-${weaponClass}`, rig, buildPoseFrames([
      { time: 0, pose: aimPose },
      { time: 0.12, pose: mergePoseObjects(aimPose, recoilPose) },
      { time: 0.32, pose: mergePoseObjects(aimPose, { torso: poseOffset({ y: 0.06 }, { x: 0.03 }), head: poseOffset({ y: 0.02 }, { x: 0.02 }) }) }
    ]), 0.32, { loop: false }));
  });

  clips.push(buildClipFromFrames('reload-rifle', rig, buildPoseFrames([
    { time: 0, pose: getAimPoseByClass('rifle') },
    {
      time: 0.24,
      pose: mergePoseObjects(getAimPoseByClass('rifle'), {
        torso: poseOffset({ y: 0.12, z: -0.04 }, { x: -0.04 }),
        armLeft: poseOffset(null, { x: -0.46, y: 0.18, z: 0.24 }),
        armRight: poseOffset(null, { x: -0.74, y: -0.18, z: -0.16 }),
        weapon: poseOffset({ x: -1.86, y: 3.1, z: -0.52 }, { x: 0.18, y: 0.14, z: 0.84 })
      })
    },
    {
      time: 0.62,
      pose: mergePoseObjects(getAimPoseByClass('rifle'), {
        torso: poseOffset({ y: 0.16 }, { x: -0.06 }),
        armLeft: poseOffset(null, { x: -1.24, y: 0.52, z: 0.52 }),
        armRight: poseOffset(null, { x: -0.62, y: -0.22, z: -0.12 }),
        weapon: poseOffset({ x: -1.24, y: 2.6, z: -0.12 }, { x: 0.34, y: 0.18, z: 0.66 })
      })
    },
    { time: 1, pose: getAimPoseByClass('rifle') }
  ]), 1, { loop: false }));

  clips.push(buildClipFromFrames('reload-pistol', rig, buildPoseFrames([
    { time: 0, pose: getAimPoseByClass('pistol') },
    {
      time: 0.3,
      pose: mergePoseObjects(getAimPoseByClass('pistol'), {
        torso: poseOffset({ y: 0.08 }, { x: -0.04 }),
        armLeft: poseOffset(null, { x: -0.88, y: 0.32, z: 0.22 }),
        armRight: poseOffset(null, { x: -0.86, y: -0.14, z: -0.06 }),
        weapon: poseOffset({ x: -0.64, y: 1.12, z: 0.4 }, { x: 0.18, y: 0.08, z: 0.12 })
      })
    },
    {
      time: 0.62,
      pose: mergePoseObjects(getAimPoseByClass('pistol'), {
        armLeft: poseOffset(null, { x: -1.22, y: 0.48, z: 0.36 }),
        armRight: poseOffset(null, { x: -0.52 }),
        weapon: poseOffset({ x: -0.52, y: 1, z: 0.32 }, { x: 0.24, y: 0.04, z: 0.08 })
      })
    },
    { time: 0.96, pose: getAimPoseByClass('pistol') }
  ]), 0.96, { loop: false }));

  clips.push(buildClipFromFrames('reload-launcher', rig, buildPoseFrames([
    { time: 0, pose: getAimPoseByClass('launcher') },
    {
      time: 0.28,
      pose: mergePoseObjects(getAimPoseByClass('launcher'), {
        torso: poseOffset({ y: 0.12, z: -0.08 }, { x: -0.05 }),
        armLeft: poseOffset(null, { x: -0.58, y: 0.16, z: 0.32 }),
        armRight: poseOffset(null, { x: -0.72, y: -0.26, z: -0.18 }),
        weapon: poseOffset({ x: -1.44, y: 4.2, z: -0.6 }, { x: 0.08, y: 0.08, z: 0.86 })
      })
    },
    {
      time: 0.66,
      pose: mergePoseObjects(getAimPoseByClass('launcher'), {
        torso: poseOffset({ y: 0.18 }, { x: -0.08 }),
        armLeft: poseOffset(null, { x: -1.18, y: 0.42, z: 0.52 }),
        armRight: poseOffset(null, { x: -0.46, y: -0.16, z: -0.08 }),
        weapon: poseOffset({ x: -0.92, y: 3.8, z: -0.28 }, { x: 0.18, y: 0.06, z: 0.62 })
      })
    },
    { time: 1.06, pose: getAimPoseByClass('launcher') }
  ]), 1.06, { loop: false }));

  clips.push(buildClipFromFrames('reload-tool', rig, buildPoseFrames([
    { time: 0, pose: getAimPoseByClass('tool') },
    {
      time: 0.3,
      pose: mergePoseObjects(getAimPoseByClass('tool'), {
        torso: poseOffset({ y: 0.08 }, { x: -0.02 }),
        armLeft: poseOffset(null, { x: -0.46, y: 0.22, z: 0.14 }),
        armRight: poseOffset(null, { x: -0.74, y: -0.12, z: -0.12 }),
        tool: poseOffset({ x: -1.42, y: 2.82, z: -0.18 }, { x: 0.1, y: 0.06, z: 0.82 }),
        torch: poseOffset({ y: 0.14 }, { x: -0.12, z: -0.08 })
      })
    },
    {
      time: 0.62,
      pose: mergePoseObjects(getAimPoseByClass('tool'), {
        armLeft: poseOffset(null, { x: -1.02, y: 0.4, z: 0.28 }),
        armRight: poseOffset(null, { x: -0.46 }),
        tool: poseOffset({ x: -1.12, y: 2.58, z: -0.12 }, { x: 0.18, y: 0.04, z: 0.68 }),
        torch: poseOffset({ y: 0.22 }, { x: -0.06, z: -0.14 }),
        toolCanister: poseOffset({ y: 0.08 }, { z: -0.06 })
      })
    },
    { time: 0.96, pose: getAimPoseByClass('tool') }
  ]), 0.96, { loop: false }));

  clips.push(buildClipFromFrames('hit', rig, buildPoseFrames([
    {
      time: 0,
      pose: {
        torso: poseOffset({ y: 0 }, { x: 0.02 }),
        armLeft: poseOffset(null, { x: -0.12 }),
        armRight: poseOffset(null, { x: 0.12 })
      }
    },
    {
      time: 0.18,
      pose: {
        torso: poseOffset({ y: 0.18, z: 0.08 }, { x: 0.22, z: -0.08 }),
        vest: poseOffset({ y: 0.12 }, { x: 0.12 }),
        head: poseOffset({ y: 0.06 }, { x: -0.18, y: 0.12 }),
        armLeft: poseOffset(null, { x: 0.36, z: 0.26 }),
        armRight: poseOffset(null, { x: 0.56, z: -0.28 }),
        weapon: poseOffset({ z: 0.18 }, { x: 0.18, z: -0.08 }),
        tool: poseOffset({ z: 0.12 }, { x: 0.16, z: -0.08 })
      }
    },
    {
      time: 0.36,
      pose: {
        torso: poseOffset({ y: 0.04 }, { x: 0.08 }),
        head: poseOffset({ y: 0.02 }, { x: -0.08 }),
        armLeft: poseOffset(null, { x: 0.08, z: 0.08 }),
        armRight: poseOffset(null, { x: 0.12, z: -0.08 })
      }
    }
  ]), 0.36, { loop: false }));

  clips.push(buildClipFromFrames('death', rig, buildPoseFrames([
    {
      time: 0,
      pose: {
        torso: poseOffset({ y: 0 }, { x: 0.02 }),
        head: poseOffset({ y: 0 }, { x: 0.02 }),
        armLeft: poseOffset(null, { x: -0.08 }),
        armRight: poseOffset(null, { x: 0.08 })
      }
    },
    {
      time: 0.42,
      pose: {
        torso: poseOffset({ y: -0.42, z: 0.32 }, { x: 0.62, z: -0.26 }),
        vest: poseOffset({ y: -0.24 }, { x: 0.34, z: -0.12 }),
        pack: poseOffset({ y: -0.14, z: 0.22 }, { x: -0.18 }),
        head: poseOffset({ y: -0.08 }, { x: -0.42, y: -0.18 }),
        helmet: poseOffset({ y: -0.08 }, { x: -0.28, y: -0.16 }),
        armLeft: poseOffset({ y: -0.06 }, { x: 1.08, y: 0.28, z: 0.72 }),
        armRight: poseOffset({ y: -0.08 }, { x: 1.18, y: -0.3, z: -0.82 }),
        legLeft: poseOffset({ y: -0.14, z: 0.12 }, { x: -0.34, z: 0.08 }),
        legRight: poseOffset({ y: -0.12, z: -0.08 }, { x: 0.26, z: -0.08 }),
        bootLeft: poseOffset({ y: -0.08 }, { x: 0.32 }),
        bootRight: poseOffset({ y: -0.08 }, { x: -0.26 }),
        weapon: poseOffset({ x: -0.4, y: 0.52, z: 0.34 }, { x: 0.52, y: 0.22, z: 0.28 }),
        tool: poseOffset({ x: -0.32, y: 0.42, z: 0.24 }, { x: 0.42, y: 0.18, z: 0.22 }),
        torch: poseOffset({ y: -0.04, z: 0.12 }, { x: 0.22, z: 0.16 })
      }
    },
    {
      time: 0.98,
      pose: {
        torso: poseOffset({ y: -0.62, z: 0.46 }, { x: 1.04, z: -0.42 }),
        vest: poseOffset({ y: -0.32 }, { x: 0.56, z: -0.22 }),
        pack: poseOffset({ y: -0.18, z: 0.3 }, { x: -0.28 }),
        head: poseOffset({ y: -0.16 }, { x: -0.62, y: -0.24 }),
        helmet: poseOffset({ y: -0.14 }, { x: -0.44, y: -0.2 }),
        armLeft: poseOffset({ y: -0.12 }, { x: 1.42, y: 0.34, z: 1.02 }),
        armRight: poseOffset({ y: -0.16 }, { x: 1.54, y: -0.38, z: -1.12 }),
        legLeft: poseOffset({ y: -0.18, z: 0.18 }, { x: -0.54, z: 0.14 }),
        legRight: poseOffset({ y: -0.16, z: -0.12 }, { x: 0.44, z: -0.12 }),
        bootLeft: poseOffset({ y: -0.12 }, { x: 0.4 }),
        bootRight: poseOffset({ y: -0.12 }, { x: -0.34 }),
        weapon: poseOffset({ x: -0.28, y: 0.24, z: 0.54 }, { x: 0.74, y: 0.28, z: 0.42 }),
        tool: poseOffset({ x: -0.22, y: 0.18, z: 0.42 }, { x: 0.58, y: 0.22, z: 0.3 }),
        torch: poseOffset({ y: -0.08, z: 0.2 }, { x: 0.34, z: 0.22 })
      }
    }
  ]), 0.98, { loop: false }));

  return clips;
};

const createPistolAttachment = () => {
  const group = new THREE.Group();
  group.name = 'runtime_pistol_attachment';

  const slide = new THREE.Mesh(SHARED_PISTOL_GEOMETRIES.slide, SHARED_PISTOL_MATERIALS.dark);
  slide.position.set(0, 0.14, 0.04);
  group.add(slide);

  const frame = new THREE.Mesh(SHARED_PISTOL_GEOMETRIES.frame, SHARED_PISTOL_MATERIALS.accent);
  frame.position.set(0, 0.02, -0.04);
  group.add(frame);

  const grip = new THREE.Mesh(SHARED_PISTOL_GEOMETRIES.grip, SHARED_PISTOL_MATERIALS.grip);
  grip.position.set(0, -0.28, -0.12);
  grip.rotation.x = -0.22;
  group.add(grip);

  const barrel = new THREE.Mesh(SHARED_PISTOL_GEOMETRIES.barrel, SHARED_PISTOL_MATERIALS.dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.08, 0.52);
  group.add(barrel);

  const frontSight = new THREE.Mesh(SHARED_PISTOL_GEOMETRIES.sight, SHARED_PISTOL_MATERIALS.accent);
  frontSight.position.set(0, 0.26, 0.42);
  group.add(frontSight);

  const rearSight = new THREE.Mesh(SHARED_PISTOL_GEOMETRIES.sight, SHARED_PISTOL_MATERIALS.accent);
  rearSight.position.set(0, 0.25, -0.12);
  group.add(rearSight);

  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.name = 'runtime_pistol_muzzle';
  muzzleAnchor.position.set(0, 0.08, 0.78);
  group.add(muzzleAnchor);
  group.userData.muzzleAnchor = muzzleAnchor;

  group.rotation.set(0.06, 0, Math.PI / 2);
  group.position.set(-0.78, 1.64, 0.68);

  return group;
};

export class Soldier {
  constructor(root, options = {}) {
    this.root = root;
    this.rig = buildSoldierRig(root);
    this.weaponType = null;
    this.weaponProfile = getSoldierWeaponAnimationProfile(options.weaponType);
    this.loopState = 'idle';
    this.currentState = null;
    this.currentAction = null;
    this.activeTransientState = null;
    this.pendingLoopState = 'idle';
    this.recoil = 0;
    this.lastTokens = {
      fire: -1,
      reload: -1,
      hit: -1,
      death: -1
    };
    this.tmpVec3 = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.actionDurations = new Map();
    this.aimParts = {
      head: this.rig.head?.node || null,
      helmet: this.rig.helmet?.node || null,
      torso: this.rig.torso?.node || null
    };
    this.weaponMountNode = this.rig.weapon?.node || this.rig.tool?.node || this.rig.armRight?.node || null;
    this.originalWeaponChildren = this.weaponMountNode
      ? this.weaponMountNode.children.filter((child) => child.name !== 'runtime_pistol_attachment')
      : [];
    this.pistolAttachment = this.weaponMountNode ? createPistolAttachment() : null;
    if (this.weaponMountNode && this.pistolAttachment) {
      this.weaponMountNode.add(this.pistolAttachment);
    }
    this.mixerFinishedHandler = (event) => {
      const finishedState = event.action?.getClip?.()?.name;
      if (!finishedState || finishedState !== this.activeTransientState) return;
      if (finishedState === 'death') {
        this.activeTransientState = null;
        this.currentState = 'death';
        this.currentAction = event.action;
        return;
      }
      this.activeTransientState = null;
      this.playLoopState(this.pendingLoopState || this.loopState || 'idle', DEFAULT_FADE_SECONDS, true);
    };

    this.mixer.addEventListener('finished', this.mixerFinishedHandler);
    this.initializeActions();
    this.setWeaponType(options.weaponType || 'rifleman');
    this.playLoopState('idle', 0.01, true);
  }

  initializeActions() {
    createAnimationLibrary(this.rig).forEach((clip) => {
      const action = this.mixer.clipAction(clip);
      const loop = clip.userData?.loop !== false;
      action.enabled = true;
      action.clampWhenFinished = !loop;
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.setEffectiveWeight(0);
      this.actions.set(clip.name, action);
      this.actionDurations.set(clip.name, clip.duration || 0.3);
    });
  }

  setWeaponType(nextWeaponType = 'rifleman') {
    if (this.weaponType === nextWeaponType) return;
    this.weaponType = nextWeaponType;
    this.weaponProfile = getSoldierWeaponAnimationProfile(nextWeaponType);
    this.syncWeaponAttachmentVisibility();
  }

  syncWeaponAttachmentVisibility() {
    const weaponClass = this.weaponProfile.weaponClass;

    if (this.originalWeaponChildren.length) {
      const showOriginalWeapon = weaponClass !== 'pistol';
      this.originalWeaponChildren.forEach((child) => {
        child.visible = showOriginalWeapon;
      });
    }

    if (this.pistolAttachment) {
      this.pistolAttachment.visible = weaponClass === 'pistol';
    }

    if (this.rig.weapon?.node) {
      this.rig.weapon.node.visible = weaponClass !== 'tool';
    }

    if (this.rig.tool?.node) {
      this.rig.tool.node.visible = weaponClass === 'tool';
    }

    if (this.rig.toolCanister?.node) {
      this.rig.toolCanister.node.visible = weaponClass === 'tool';
    }

    if (this.rig.torch?.node) {
      this.rig.torch.node.visible = weaponClass === 'tool';
    }
  }

  getMuzzleAnchor() {
    if (this.weaponProfile.weaponClass === 'pistol' && this.pistolAttachment?.userData?.muzzleAnchor) {
      return this.pistolAttachment.userData.muzzleAnchor;
    }

    if (this.weaponProfile.weaponClass === 'tool') {
      return this.rig.toolNozzle?.node || this.rig.torch?.node || this.weaponMountNode;
    }

    if (this.weaponProfile.weaponClass === 'launcher') {
      return this.rig.launcherProbe?.node || this.rig.weaponMuzzle?.node || this.weaponMountNode;
    }

    return this.rig.weaponMuzzle?.node || this.weaponMountNode;
  }

  getTransientDurationSeconds(stateName) {
    if (stateName === 'hit') return SOLDIER_HIT_ANIMATION_MS / 1000;
    if (stateName === 'death') return SOLDIER_DEATH_ANIMATION_MS / 1000;
    if (stateName === this.weaponProfile.fireClip) return Math.max(0.2, this.weaponProfile.fireAnimationMs / 1000);
    if (stateName === this.weaponProfile.reloadClip) return Math.max(0.3, this.weaponProfile.reloadDurationMs / 1000);
    return this.actionDurations.get(stateName) || 0.3;
  }

  applyActionTimeScale(action, stateName) {
    if (!action) return;
    const clipDuration = Math.max(0.001, this.actionDurations.get(stateName) || action.getClip()?.duration || 0.3);
    const targetDuration = this.getTransientDurationSeconds(stateName);
    action.setEffectiveTimeScale(clipDuration / Math.max(0.001, targetDuration));
  }

  playLoopState(stateName, fadeSeconds = DEFAULT_FADE_SECONDS, force = false) {
    const action = this.actions.get(stateName);
    if (!action) return;

    this.pendingLoopState = stateName;
    if (this.activeTransientState && !force) return;
    if (!force && this.loopState === stateName && this.currentAction === action) return;

    const previousAction = this.currentAction;
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.play();
    if (previousAction && previousAction !== action) {
      action.crossFadeFrom(previousAction, fadeSeconds, false);
    } else {
      action.fadeIn(fadeSeconds);
    }

    this.loopState = stateName;
    this.currentState = stateName;
    this.currentAction = action;
  }

  triggerTransient(stateName, fadeSeconds = DEFAULT_FADE_SECONDS) {
    const action = this.actions.get(stateName);
    if (!action) return;

    const previousAction = this.currentAction;
    this.activeTransientState = stateName;
    this.currentState = stateName;
    this.currentAction = action;
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    this.applyActionTimeScale(action, stateName);
    action.play();
    if (previousAction && previousAction !== action) {
      action.crossFadeFrom(previousAction, fadeSeconds, false);
    } else {
      action.fadeIn(fadeSeconds);
    }
  }

  resolveDesiredLoopState(snapshot = {}) {
    if (snapshot.dead) return 'death';
    if (snapshot.repairing) return 'aim-tool';
    if (snapshot.aiming || snapshot.hasTargetInRange) return this.weaponProfile.aimClip;
    if ((snapshot.normalizedSpeed || 0) > RUN_STATE_THRESHOLD) return 'run';
    if ((snapshot.normalizedSpeed || 0) > WALK_STATE_THRESHOLD) return 'walk';
    return 'idle';
  }

  applyLoopTimeScale(snapshot = {}) {
    const walkAction = this.actions.get('walk');
    const runAction = this.actions.get('run');
    const normalizedSpeed = THREE.MathUtils.clamp(snapshot.normalizedSpeed || 0, 0, 1.35);

    if (walkAction) {
      walkAction.setEffectiveTimeScale(THREE.MathUtils.lerp(0.72, 1.02, normalizedSpeed));
    }

    if (runAction) {
      runAction.setEffectiveTimeScale(THREE.MathUtils.lerp(0.82, 1.1, normalizedSpeed));
    }
  }

  applyAimOffsets(delta, snapshot = {}) {
    const targetPosition = snapshot.targetPosition;
    const rootPosition = snapshot.position;
    if (!targetPosition || !rootPosition) return;

    const dx = targetPosition.x - rootPosition.x;
    const dz = targetPosition.z - rootPosition.z;
    const dy = (targetPosition.y || rootPosition.y || 0) - (rootPosition.y || 0);
    const horizontalDistance = Math.max(1, Math.hypot(dx, dz));
    const pitch = THREE.MathUtils.clamp(Math.atan2(dy, horizontalDistance), -0.28, 0.24);
    const lateral = THREE.MathUtils.clamp(snapshot.lateralAimOffset || 0, -0.42, 0.42);
    const t = Math.min(1, delta * 8);
    const torsoNode = this.aimParts.torso;
    const headNode = this.aimParts.head;
    const helmetNode = this.aimParts.helmet;

    if (torsoNode) {
      torsoNode.rotation.y = THREE.MathUtils.lerp(torsoNode.rotation.y, torsoNode.rotation.y + lateral * 0.18, t * 0.4);
      torsoNode.rotation.x = THREE.MathUtils.lerp(torsoNode.rotation.x, torsoNode.rotation.x - pitch * 0.26, t * 0.55);
    }

    if (headNode) {
      headNode.rotation.y = THREE.MathUtils.lerp(headNode.rotation.y, headNode.rotation.y + lateral * 0.34, t);
      headNode.rotation.x = THREE.MathUtils.lerp(headNode.rotation.x, headNode.rotation.x - pitch * 0.6, t);
    }

    if (helmetNode) {
      helmetNode.rotation.y = THREE.MathUtils.lerp(helmetNode.rotation.y, helmetNode.rotation.y + lateral * 0.24, t * 0.9);
      helmetNode.rotation.x = THREE.MathUtils.lerp(helmetNode.rotation.x, helmetNode.rotation.x - pitch * 0.46, t * 0.9);
    }
  }

  applyRecoil(delta) {
    const t = Math.min(1, delta * 14);
    this.recoil = THREE.MathUtils.lerp(this.recoil, 0, t);
    if (this.recoil <= 0.001) return;

    const amount = this.recoil * (this.weaponProfile.recoilAmount || 0.5);
    const mount = this.weaponMountNode;
    if (mount) {
      mount.position.z -= amount * 0.12;
      mount.rotation.x += amount * 0.05;
    }

    if (this.rig.armRight?.node) {
      this.rig.armRight.node.rotation.x += amount * 0.06;
      this.rig.armRight.node.rotation.z -= amount * 0.03;
    }

    if (this.rig.armLeft?.node && this.weaponProfile.weaponClass !== 'pistol') {
      this.rig.armLeft.node.rotation.x += amount * 0.025;
    }

    if (this.rig.torso?.node) {
      this.rig.torso.node.rotation.x -= amount * 0.035;
    }
  }

  update(delta, snapshot = {}) {
    this.setWeaponType(snapshot.weaponType || this.weaponType || 'rifleman');

    if ((snapshot.deathSequence || 0) > this.lastTokens.death) {
      this.lastTokens.death = snapshot.deathSequence || 0;
      this.triggerTransient('death', 0.12);
    } else if (!snapshot.dead && (snapshot.hitSequence || 0) > this.lastTokens.hit) {
      this.lastTokens.hit = snapshot.hitSequence || 0;
      this.triggerTransient('hit', 0.08);
    } else if (!snapshot.dead && (snapshot.reloadSequence || 0) > this.lastTokens.reload) {
      this.lastTokens.reload = snapshot.reloadSequence || 0;
      this.triggerTransient(this.weaponProfile.reloadClip, 0.12);
    } else if (!snapshot.dead && (snapshot.fireSequence || 0) > this.lastTokens.fire) {
      this.lastTokens.fire = snapshot.fireSequence || 0;
      this.recoil = 0.82;
      this.triggerTransient(this.weaponProfile.fireClip, 0.08);
    }

    const desiredLoopState = this.resolveDesiredLoopState(snapshot);
    if (desiredLoopState !== 'death') {
      this.pendingLoopState = desiredLoopState;
      this.playLoopState(desiredLoopState, DEFAULT_FADE_SECONDS);
    }

    this.applyLoopTimeScale(snapshot);
    this.mixer.update(delta);
    this.applyAimOffsets(delta, snapshot);
    this.applyRecoil(delta);
    this.root.updateMatrixWorld(true);
  }

  dispose() {
    if (this.mixerFinishedHandler) {
      this.mixer.removeEventListener('finished', this.mixerFinishedHandler);
    }
    this.actions.forEach((action) => {
      action.stop();
      action.reset();
    });
    this.mixer.stopAllAction();
    if (this.root) {
      this.mixer.uncacheRoot(this.root);
    }
    if (this.pistolAttachment?.parent) {
      this.pistolAttachment.parent.remove(this.pistolAttachment);
    }
  }
}
