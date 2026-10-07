# Handoff — HiMed Opción B (provider multi-credencial unificado)

/ 2026-10-03

## Goal of next session

Cerrar S9: re-correr el happy-path E2E contra el sandbox de HiMed **cuando el sandbox
vuelva a responder**, y luego abrir los PRs a `dev` de las dos ramas. El build (S1–S8, S10)
está completo; lo único vivo es la verificación E2E bloqueada por una caída del sandbox y la
apertura de PRs.

## State of play

**Opción B implementada y pusheada en DOS ramas (no mergeadas aún):**
- `xcale-mcp-server` → rama `feat/himed-provider` (worktree `C:\Users\estra\xcale\wt-himed-provider`), head `fa4f123`.
- `xcale-backend` → rama `feat/himed-connect`, head `a3ef3d67`.

**Slices (tracker completo en `docs/design/himed-unified-provider/implementation-plan.md`):**
- **S1–S4** (mcp-server): tipos core + materializer group-aware + revert Opción A + provider `himed` unificado. ✅
- **S5–S8** (backend): contrato de consumo, connect multi-secreto (bundle cifrado), catálogo/vertical-scope/i18n (un `himed`), ripple Fase 3 lifecycle-messages. ✅
- **S10** (backend): un solo `himed-clinic-agent` + limpieza de refs `himed-scheduling`. ✅
- **S9** (verificación sandbox): 🟡 código + harness listos; unit de ruteo por grupo verde (9 tests); **happy-path live BLOQUEADO solo por caída del sandbox**.

**Bloqueo S9 — caída del sandbox de HiMed (confirmado 2026-10-03):** los endpoints POST
devuelven 504/502; desde el provider llega como `PROVIDER_UNAVAILABLE` / `HTTP 0` (timeout).
GET a los hosts da 200 y la red local está bien → es caída del lado de HiMed, no nuestra. El
provider clasifica fail-closed (correcto). Detalle y evidencia en el ship-log (sección 2026-10-03).

**Credenciales del sandbox:** cargadas en `wt-himed-provider/.env.himed.sandbox` (gitignoreado,
patrón `.env.*`, nunca commiteado). El harness lo lee solo vía su loader. Ventana del sandbox
hasta **2026-10-09**.

**⚠️ Working tree:** `xcale-backend` está checked-out en otra rama (`feat/woocommerce-shipping-quote`,
trabajo ajeno en curso) — por eso los archivos de agent-templates se ven sin el template HiMed.
El trabajo HiMed **está seguro y pusheado** en `feat/himed-connect`; solo hay que hacer
`git switch feat/himed-connect` para verlo. No tocar la rama de WooCommerce.

## Immediate next step

1. Chequear si el sandbox revivió (one-liner en el ship-log §2026-10-03, o un GET/POST a
   `demo.medsas.co/.../Sedes/consultarSedes.php`).
2. Si está arriba: `cd wt-himed-provider && npx tsx scripts/himed-unified-sandbox-e2e.ts`
   (entra en modo FULL leyendo `.env.himed.sandbox`; crea paciente de prueba + cita y cancela al final).
3. Marcar S9 ✅ en el implementation-plan y registrar el resultado en el ship-log.

## Open decisions

- **Numeración de ADRs al mergear:** el ADR `himed-multi-credential-provider` (y cualquier otro
  de estas ramas) va **sin número** en la rama; se numera al mergear (convención de Mateo).
- **Orden/forma de merge:** las dos ramas se mergean **juntas** (el backend consume el catálogo
  nuevo del mcp-server). Definir si mcp-server entra primero a `dev` y luego backend, o coordinado.
- **Autoagendamiento host en producción:** el default del provider es `socket.medsas.co` (sin DNS
  público); el sandbox usa `demo-notificaciones.medsas.co`. En deploy se setea por env
  (`HIMED_BASE_URL` / `HIMED_SCHEDULING_BASE_URL`), no es cambio de código — confirmar el host prod con HiMed.

## Skills to use

- `/git-workflow` para abrir los PRs a `dev` (uno por repo) y, al mergear, la numeración de ADRs + archivado del design folder tras soak.
- El harness E2E (`scripts/himed-unified-sandbox-e2e.ts`) para cerrar S9; no requiere `/qa` (es verificación directa del provider contra el sandbox).

## Artifacts

- Diseño (mcp-server): `docs/design/himed-unified-provider/{feature-design,api-contract,implementation-plan,ship-log}.md`
- ADR (sin numerar): `docs/adr/himed-multi-credential-provider.md`
- Harness E2E: `scripts/himed-unified-sandbox-e2e.ts` (worktree `wt-himed-provider`)
- Credenciales locales (gitignored): `wt-himed-provider/.env.himed.sandbox`
- Ramas: `feat/himed-provider` (mcp-server, head `fa4f123`) · `feat/himed-connect` (xcale-backend, head `a3ef3d67`)
- Ship-log previo de Opción A (evidencia de sandbox cruda): `xcale-backend` `docs/design/himed-connect/ship-log.md` (en la rama `feat/himed-connect`)
