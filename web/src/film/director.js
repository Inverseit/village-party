// Demo film only: takes the island's camera away from its orbit controls and flies it along
// a shot's keyframes. Keys: { t (s), p: [x,y,z], a: [x,y,z] look-at, fov? }.
const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10);
const lerp = (a, b, k) => a + (b - a) * k;

export function cameraAt(shot, t) {
  const keys = shot.cam;
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const A = keys[i], B = keys[i + 1];
    if (t <= B.t) {
      const k = (B.linear ? (x => Math.min(1, Math.max(0, x))) : ease)((t - A.t) / (B.t - A.t));
      return { p: A.p.map((v, j) => lerp(v, B.p[j], k)), a: A.a.map((v, j) => lerp(v, B.a[j], k)), fov: lerp(A.fov ?? 42, B.fov ?? 42, k) };
    }
  }
  return keys.at(-1);
}

// cheap smooth noise for handheld shake
const n1 = x => Math.sin(x * 1.7) * 0.5 + Math.sin(x * 3.1 + 1.3) * 0.3 + Math.sin(x * 7.3 + 2.1) * 0.2;

export function attach(el, getShot, getT) {
  const cam = el.camera, V = Object.getPrototypeOf(cam.position);
  const target = new (cam.position.constructor)();
  cam.position.set = function (x, y, z) {
    const shot = getShot(), t = getT();
    if (!shot?.cam) return V.set.call(this, x, y, z);
    const c = cameraAt(shot, t), sh = typeof shot.shake === 'function' ? shot.shake(t) : (shot.shake || 0);
    V.set.call(this, c.p[0] + n1(t * 9) * sh, c.p[1] + n1(t * 11 + 4) * sh * 0.7, c.p[2] + n1(t * 10 + 8) * sh);
    target.set(c.a[0], c.a[1], c.a[2]);
    const fov = c.fov ?? 42;
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return this;
  };
  const look = cam.lookAt.bind(cam);
  cam.lookAt = (...a) => getShot()?.cam ? look(target) : look(...a);
}
