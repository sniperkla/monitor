const snapLower = "some previous terminal output with enabled in it".toLowerCase();
const installDoneSignals = [
  /successfully installed/i, /installation complete/i, /installed successfully/i,
  /already installed/i, /is up to date/i, /nothing to install/i,
  /successfully started/i, /running.*active/i, /enabled/i,
];
console.log(installDoneSignals.some(r => r.test(snapLower)));
