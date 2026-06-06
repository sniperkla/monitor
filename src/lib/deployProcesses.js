// Simple in-memory registry of running deployment processes per project
const runningMap = new Map();

export function setRunning(projectId, info) {
  runningMap.set(projectId, info);
}

export function getRunning(projectId) {
  return runningMap.get(projectId);
}

export function clearRunning(projectId) {
  runningMap.delete(projectId);
}
