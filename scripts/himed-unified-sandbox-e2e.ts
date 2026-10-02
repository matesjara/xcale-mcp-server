/**
 * HiMed unified-provider sandbox E2E (S9 of himed-unified-provider).
 *
 * Drives the ONE `himed` provider through its three credential groups against the LIVE HiMed sandbox,
 * proving the unification end-to-end: each tool resolves its own group secret and reaches its own host
 * (Demográficos + directory on demo.medsas.co, Autoagendamiento on demo-notificaciones.medsas.co),
 * from a single connection carrying the three-secret bundle + codigo_servicio.
 *
 * Secrets come from the environment — NEVER committed (see docs/design/himed-unified-provider/ship-log.md).
 * Sandbox window per the ship-log: 2026-10-01 → 2026-10-09.
 *
 *   HIMED_DEMOGRAFICOS_TOKEN          Token Demográficos (patient writes)
 *   HIMED_DIRECTORIO_TOKEN            Token de Servicio (directory: sedes/doctores)
 *   HIMED_AUTOAGENDAMIENTO_TOKEN      Autoagendamiento token
 *   HIMED_CODIGO_SERVICIO             Autoagendamiento service code (the connection accountKey)
 *
 * Optional overrides (default to the sandbox hosts):
 *   HIMED_BASE_URL                    Demográficos + directory base
 *   HIMED_SCHEDULING_BASE_URL         Autoagendamiento endpoint
 *
 * Optional booking inputs (default to the ship-log's verified sandbox values):
 *   HIMED_E2E_ID_PACIENTE (1099999001), HIMED_E2E_ID_SEDE (1),
 *   HIMED_E2E_ID_USUARIO (1152442529), HIMED_E2E_FECHA (DD-MM-YYYY), HIMED_E2E_HORA (09:00:00)
 *
 * Modes:
 *   - All four credential vars set  → FULL happy-path flow (mutates the sandbox, then cleans up).
 *   - Credentials absent            → PROBE mode (dummy secrets, no real credentials needed): asserts
 *                                     each group reaches its host and a bad token classifies as
 *                                     AUTH_EXPIRED. This is what runs in CI / a dev box with no secrets.
 *
 * Run: npx tsx scripts/himed-unified-sandbox-e2e.ts
 */

import { createHimedProvider } from '../src/providers/himed/provider';
import { SecretString } from '../src/core/secret-string';

const BASE_URL =
  process.env.HIMED_BASE_URL ??
  'https://demo.medsas.co/interoperabilidad/Api/Controllers';
const SCHEDULING_BASE_URL =
  process.env.HIMED_SCHEDULING_BASE_URL ??
  'https://demo-notificaciones.medsas.co/notificaciones/envioConsumoAutoagendamiento';

const demograficos = process.env.HIMED_DEMOGRAFICOS_TOKEN;
const directorio = process.env.HIMED_DIRECTORIO_TOKEN;
const autoagendamiento = process.env.HIMED_AUTOAGENDAMIENTO_TOKEN;
const codigoServicio = process.env.HIMED_CODIGO_SERVICIO;

const HAVE_CREDS = Boolean(
  demograficos && directorio && autoagendamiento && codigoServicio,
);

const provider = createHimedProvider({
  baseUrl: BASE_URL,
  schedulingBaseUrl: SCHEDULING_BASE_URL,
});

function ctx(secrets: {
  demograficos: string;
  directorio: string;
  autoagendamiento: string;
  codigoServicio: string;
}) {
  return {
    credential: {
      secret: new SecretString(secrets.demograficos),
      secrets: {
        demograficos: new SecretString(secrets.demograficos),
        directorio: new SecretString(secrets.directorio),
        autoagendamiento: new SecretString(secrets.autoagendamiento),
      },
    },
    metadata: { codigo_servicio: secrets.codigoServicio },
  };
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  const mark = ok ? '✅' : '🔴';
  console.log(`${mark} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
}

async function probeMode(): Promise<void> {
  console.log(
    '\n=== PROBE mode (no credentials) — routing + auth classification against the live sandbox ===\n',
  );
  const dummy = ctx({
    demograficos: 'xcale-s9-dummy',
    directorio: 'xcale-s9-dummy',
    autoagendamiento: 'xcale-s9-dummy',
    codigoServicio: '0000',
  });

  // directorio group → demo.medsas.co/Sedes/consultarSedes.php
  const dir = await provider.callTool('mcp_himed_list_locations', {}, dummy);
  check(
    'directorio group reached its host and classified a bad token as AUTH_EXPIRED',
    dir.kind === 'error' && dir.code === 'PROVIDER_AUTH_EXPIRED',
    dir,
  );

  // demograficos group → demo.medsas.co/Demograficos/crearPaciente.php
  const demo = await provider.callTool(
    'mcp_himed_create_patient',
    {
      tipoDocumento: 'CC',
      idPaciente: '11111111',
      primerNombre: 'Probe',
      primerApellido: 'Xcale',
      fechaNacimiento: '1990-01-01',
    },
    dummy,
  );
  check(
    'demograficos group reached its host and rejected the bad token',
    demo.kind === 'error' && demo.code === 'PROVIDER_AUTH_EXPIRED',
    demo,
  );

  // autoagendamiento group → demo-notificaciones.medsas.co (RPC accion)
  const sched = await provider.callTool(
    'mcp_himed_list_patient_appointments',
    { idPaciente: '11111111', forma: 'texto' },
    dummy,
  );
  check(
    'autoagendamiento group reached its host and classified a bad token as AUTH_EXPIRED',
    sched.kind === 'error' && sched.code === 'PROVIDER_AUTH_EXPIRED',
    sched,
  );
}

async function fullFlow(): Promise<void> {
  console.log('\n=== FULL happy-path flow (live sandbox, with credentials) ===\n');
  const c = ctx({
    demograficos: demograficos!,
    directorio: directorio!,
    autoagendamiento: autoagendamiento!,
    codigoServicio: codigoServicio!,
  });

  const idPaciente = process.env.HIMED_E2E_ID_PACIENTE ?? '1099999001';
  const idSede = process.env.HIMED_E2E_ID_SEDE ?? '1';
  const idUsuario = process.env.HIMED_E2E_ID_USUARIO ?? '1152442529';
  const fechaCita = process.env.HIMED_E2E_FECHA ?? '08-10-2026';
  const horaInicioCita = process.env.HIMED_E2E_HORA ?? '09:00:00';

  // 1) directory read (the probe tool) — directorio group
  const locations = await provider.callTool('mcp_himed_list_locations', {}, c);
  check('list_locations (directorio) succeeds', locations.kind === 'success', locations);

  // 2) create the test patient — demograficos group
  const patient = await provider.callTool(
    'mcp_himed_create_patient',
    {
      tipoDocumento: 'CC',
      idPaciente,
      primerNombre: 'Prueba',
      primerApellido: 'Xcale',
      fechaNacimiento: '1990-01-01',
    },
    c,
  );
  check('create_patient (demograficos, fecha YYYY-MM-DD) succeeds', patient.kind === 'success', patient);

  // 3) book — autoagendamiento group. CrearCita returns ONLY idCita.
  const booked = await provider.callTool(
    'mcp_himed_create_appointment',
    { idPaciente, idSede: Number(idSede), idUsuario, fechaCita, horaInicioCita, modalidadAtencion: 1 },
    c,
  );
  check('create_appointment (autoagendamiento) succeeds', booked.kind === 'success', booked);
  const idCita =
    booked.kind === 'success'
      ? String((booked.data as { idCita?: unknown })?.idCita ?? '')
      : '';
  check('create_appointment returned an idCita', idCita !== '', idCita);

  // 4) the verifier read — the booked cita must be present
  const listed = await provider.callTool(
    'mcp_himed_list_patient_appointments',
    { idPaciente, forma: 'texto' },
    c,
  );
  const present =
    listed.kind === 'success' &&
    JSON.stringify((listed.data as unknown) ?? '').includes(idCita);
  check('list_patient_appointments lists the new cita (verifier: holds)', present, listed);

  // 5) cancel — autoagendamiento group, idPaciente required
  const cancelled = await provider.callTool(
    'mcp_himed_cancel_appointment',
    { idCita, idPaciente },
    c,
  );
  check('cancel_appointment (idPaciente required) succeeds', cancelled.kind === 'success', cancelled);

  // 6) the cancelled cita disappears (verifier: resolved)
  const after = await provider.callTool(
    'mcp_himed_list_patient_appointments',
    { idPaciente, forma: 'texto' },
    c,
  );
  const gone =
    after.kind === 'success' &&
    !JSON.stringify((after.data as unknown) ?? '').includes(idCita);
  check('the cancelled cita is gone (verifier: resolved)', gone, after);
}

async function main(): Promise<void> {
  console.log('HiMed unified-provider sandbox E2E (S9)');
  console.log(`  base:       ${BASE_URL}`);
  console.log(`  scheduling: ${SCHEDULING_BASE_URL}`);
  if (HAVE_CREDS) await fullFlow();
  else await probeMode();

  console.log('');
  if (failures > 0) {
    console.error(`S9: ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(
    HAVE_CREDS
      ? 'S9: full sandbox flow GREEN through the unified provider.'
      : 'S9 PROBE GREEN: unified provider routes each group to its host and classifies auth correctly. ' +
          'Set HIMED_DEMOGRAFICOS_TOKEN / HIMED_DIRECTORIO_TOKEN / HIMED_AUTOAGENDAMIENTO_TOKEN / ' +
          'HIMED_CODIGO_SERVICIO for the full happy-path flow.',
  );
}

main().catch((err) => {
  console.error('S9 harness crashed:', err);
  process.exit(1);
});
