import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// The app's port is declared in four places, and they must agree.
//
// They did not: deploy/nginx/docker/default.conf proxied to `monitor:3000`
// while the Dockerfile and docker-compose.yml had said 3030 since 2026-05-30
// (977db5a9). Nothing noticed, because a wrong upstream port is invisible until
// you actually deploy — a fresh `docker compose up -d --build` proxied to a
// port nothing was listening on and 502'd every request.
//
// This is a pure drift guard: it asserts the declarations agree, not that any
// particular number is right.
const dockerfile = read('../Dockerfile');
const compose = read('../docker-compose.yml');
const envExample = read('../.env.example');
const dockerConf = read('../deploy/nginx/docker/default.conf');
const hostConf = read('../deploy/nginx/monitor.eaqdragon.com.conf');

/** Pull every capture of `re` and assert they all agree. */
const onePort = (re, src, label) => {
  const found = [...src.matchAll(re)].map((m) => m[1]);
  assert.ok(found.length > 0, `${label}: no port declaration found`);
  assert.equal(new Set(found).size, 1, `${label}: declarations disagree (${found.join(', ')})`);
  return found[0];
};

const dockerfilePort = onePort(/^ENV PORT=(\d+)$/gm, dockerfile, 'Dockerfile');

test('the container port is declared consistently', () => {
  const composePort = onePort(/^\s*PORT:\s*(\d+)/gm, compose, 'docker-compose.yml');
  const examplePort = onePort(/^PORT=(\d+)$/gm, envExample, '.env.example');

  assert.equal(composePort, dockerfilePort, 'compose PORT must match the Dockerfile ENV PORT');
  assert.equal(examplePort, dockerfilePort, '.env.example PORT must match the Dockerfile ENV PORT');
});

test('the docker nginx upstream matches the container port', () => {
  // The live topology: nginx is its own container on `proxy-net` and reaches the
  // app by service name. If this port is wrong every request 502s.
  const upstream = onePort(
    /proxy_pass http:\/\/monitor:(\d+);/g, dockerConf, 'deploy/nginx/docker/default.conf'
  );
  assert.equal(
    upstream, dockerfilePort,
    'nginx proxies to a port the app is not listening on — every request would 502'
  );
});

test('the host nginx upstream matches the container port', () => {
  // This variant additionally requires compose to publish the port on the host;
  // it cannot be true that the two files disagree on the number, though.
  const upstream = onePort(
    /proxy_pass http:\/\/127\.0\.0\.1:(\d+);/g, hostConf, 'deploy/nginx/monitor.eaqdragon.com.conf'
  );
  assert.equal(upstream, dockerfilePort);
});
