// Raeumt den Wegwerf-Container nach dem Lauf weg. Mit ihm verschwinden auch
// die Testnutzer und -dateien -- der naechste Lauf faengt wieder bei null an.
//
// RELAY_TEST_KEEP=1 laesst den Container stehen (nuetzlich, um nach einem
// fehlgeschlagenen Lauf noch in die Datenbank oder ins Log zu schauen).
const { execFileSync } = require("child_process");

const { CONTAINER, EXTERNAL } = require("./test-env");

module.exports = async () => {
  if (EXTERNAL) return; // fremde Instanz -> nicht anfassen
  if (process.env.RELAY_TEST_KEEP === "1") {
    console.log(`[e2e] RELAY_TEST_KEEP=1 -> Container ${CONTAINER} bleibt stehen`);
    return;
  }
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "pipe" });
    console.log(`[e2e] Container ${CONTAINER} entfernt`);
  } catch (e) {
    console.warn(`[e2e] Container ${CONTAINER} konnte nicht entfernt werden: ${e.message}`);
  }
};
