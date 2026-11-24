#!/usr/bin/env bash
# Сквозная проверка пакета глазами потребителя — будущий CI репозитория
# dmg-core. Запуск из корня пакета с установленными зависимостями:
#
#   bun run e2e
#
# 1. npm publish --dry-run без исправлений package.json; состав tarball.
# 2. Установка tarball в пустой проект → импорт и ArchChecker.
# 3. dmg-core init → sync --check; документация, скилы и ссылки на месте
#    (consumer-check.ts); biome потребителя загружает плагины пакета.
# 4. gen создаёт модуль, тесты заготовок зелёные на установленном пакете.
# 5. Профили single и monorepo: init --profile → gen module/aggregate/uc
#    (модуль подключает сам gen) → без ручных правок раннер вызывает UC
#    создания (`call --user`) → bun run check проекта зелёный; TODO
#    заготовок: arch:check — предупреждения (0), --strict — MAN-01 (1); путь к
#    tarball в зависимости (и overrides monorepo) — от корня проекта.
set -euo pipefail

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "e2e: npm publish --dry-run"
PUBLISH="$(cd "$PKG" && npm publish --dry-run 2>&1)"
if grep -q 'errors corrected' <<<"$PUBLISH"; then
  grep 'warn publish' <<<"$PUBLISH" >&2
  echo "e2e: npm исправил бы package.json при публикации" >&2
  exit 1
fi
for field in license author; do
  if [ "$(jq -r ".$field // empty" "$PKG/package.json")" = "" ]; then
    echo "e2e: в package.json нет $field" >&2
    exit 1
  fi
done

echo "e2e: bun pm pack и состав tarball"
(cd "$PKG" && bun pm pack --destination "$WORK" >/dev/null)
TARBALL="$(ls "$WORK"/dmg-core-*.tgz)"
FILES="$(tar -tzf "$TARBALL")"
for need in LICENSE llms.txt README.md docs/index.md docs/reference/rules.md \
  skills/dmg-architecture/SKILL.md agents/README.md \
  biome-plugins/dom-14-no-clock.grit src/index.ts src/cli/main.ts \
  src/testing/example/screen/screen.graph.ts src/testing/example/index.ts; do
  if ! grep -qx "package/$need" <<<"$FILES"; then
    echo "e2e: в tarball нет $need" >&2
    exit 1
  fi
done
# Тесты в поставке — только учебного модуля (образец для гайдов).
EXTRA="$(grep -E '^package/(scripts|lint-fixtures|node_modules)|\.test\.ts$' <<<"$FILES" |
  grep -v '^package/src/testing/example/' || true)"
if [ -n "$EXTRA" ]; then
  echo "e2e: лишнее в tarball:" >&2
  echo "$EXTRA" >&2
  exit 1
fi

echo "e2e: установка tarball в пустой проект"
mkdir "$WORK/consumer"
cd "$WORK/consumer"
cat >package.json <<JSON
{ "name": "consumer", "private": true, "type": "module" }
JSON
bun add "$TARBALL" valibot @valibot/to-json-schema >/dev/null
cat >smoke.ts <<'TS'
import { ArchChecker } from 'dmg-core/arch';
import { ExampleArch } from 'dmg-core/testing';
import { ExampleApp } from 'dmg-core/testing/example';
import { ScreenArch } from 'dmg-core/testing/example/screen.arch';

const violations = [
  ...ArchChecker.of(ExampleArch).check(),
  ...ArchChecker.of(ScreenArch).check(),
];
if (violations.length > 0) {
  console.error(violations);
  process.exit(1);
}
// Неиспользуемый импорт транспилятор выбросит — проверяем значение явно.
if (typeof ExampleApp !== 'function') {
  console.error('consumer: dmg-core/testing/example не отдаёт ExampleApp');
  process.exit(1);
}
console.log('consumer: dmg-core импортируется, ArchChecker чист');
TS
bun run smoke.ts

echo "e2e: init и документация в проекте-потребителе"
bunx dmg-core init
bunx dmg-core sync --check
bun "$PKG/scripts/consumer-check.ts" "$WORK/consumer"

echo "e2e: biome потребителя загружает плагины пакета"
bun add -d "@biomejs/biome@$(jq -r '.devDependencies["@biomejs/biome"]' "$PKG/package.json")" >/dev/null
mkdir -p lint
echo 'export const at = Date.now();' >lint/clock.ts
cat >biome.json <<'JSON'
{
  "files": { "includes": ["lint/**"] },
  "overrides": [
    {
      "includes": ["lint/**"],
      "plugins": ["./node_modules/dmg-core/biome-plugins/dom-14-no-clock.grit"]
    }
  ]
}
JSON
# biome с найденным нарушением выходит с кодом 1 — это ожидаемо.
LINT="$(bunx biome lint --reporter=json lint 2>/dev/null || true)"
if ! grep -q 'DOM-14:' <<<"$LINT"; then
  echo "e2e: плагин DOM-14 из node_modules/dmg-core не сработал" >&2
  exit 1
fi
rm -r lint biome.json

echo "e2e: gen на установленном пакете"
bunx dmg-core gen module todo --write >/dev/null
bunx dmg-core gen aggregate todo.task --write >/dev/null
bunx dmg-core gen uc todo.task create-task --write >/dev/null
bunx dmg-core gen uc todo.task complete-task --write >/dev/null
bun test src

# Проект по профилю с нуля: пакет из tarball, каркас, срез gen (подключает
# модуль к приложению), вызов UC раннером, полный check.
# Красный шаг: хвост лога и выход.
run_logged() {
  local log="$1" what="$2"
  shift 2
  if ! "$@" >"$log" 2>&1; then
    tail -40 "$log" >&2
    echo "e2e: $what" >&2
    exit 1
  fi
}

# Имя проекта со scope (`@acme/school`) проверяет вывод scope пакетов
# monorepo из имени — как в README.
profile_e2e() {
  local profile="$1" main="$2" name="$3" appdef="$4"
  local dir="$WORK/$profile"
  echo "e2e: профиль $profile ($name)"
  mkdir "$dir"
  cd "$dir"
  echo "{ \"name\": \"$name\" }" >package.json
  bun add "$TARBALL" >/dev/null
  bunx dmg-core init --profile "$profile" >/dev/null
  # Путь к tarball — от корня проекта; в monorepo — и в overrides.
  local rel="../$(basename "$TARBALL")" fields='.dependencies["dmg-core"]'
  [ "$profile" = monorepo ] && fields="$fields .overrides[\"dmg-core\"]"
  for field in $fields; do
    if [ "$(jq -r "$field" package.json)" != "$rel" ]; then
      echo "e2e: $profile — $field не $rel: $(jq -c "$field" package.json)" >&2
      exit 1
    fi
  done
  # Линкер — явно: установка не зависит от умолчания Bun. В monorepo единица
  # видит только объявленные пакеты — на этом держатся ARC-14…16 (D-108).
  bun install --linker isolated >/dev/null
  if [ "$profile" = monorepo ] && [ ! -L runners/cli/node_modules/@acme/assembly ]; then
    echo "e2e: monorepo — установка не изолированная" >&2
    exit 1
  fi
  run_logged "$WORK/$profile-init-check.log" \
    "$profile — bun run check красный сразу после init" bun run check
  bunx dmg-core gen module todo --write >/dev/null
  bunx dmg-core gen aggregate todo.task --write >/dev/null
  bunx dmg-core gen uc todo.task create-task --write >/dev/null
  bunx dmg-core gen uc todo.task complete-task --write >/dev/null
  # Как велит gen module (project.md): в monorepo пакет модуля появляется в
  # node_modules после установки — без неё arch:check даёт ARC-15 (D-108).
  bun install --linker isolated >/dev/null
  # Подключение модуля генератором — сразу в форме biome, без format.
  run_logged "$WORK/$profile-gen-lint.log" \
    "$profile — biome красный после gen (подключение модуля)" bunx biome check .
  # Модуль вписан в манифест приложения (AppDef), а не в arch-check.ts.
  if ! grep -q 'TodoModuleDef,' "$appdef"; then
    echo "e2e: $profile — в $appdef нет TodoModuleDef, после gen module" >&2
    exit 1
  fi
  if grep -q 'gen:modules' scripts/arch-check.ts; then
    echo "e2e: $profile — в scripts/arch-check.ts остался маркер gen:modules" >&2
    exit 1
  fi
  # Незаполненные TODO заготовок: без флага — предупреждения (код 0),
  # с --strict — нарушения MAN-01 (код 1).
  local arch code
  arch="$(bun run arch:check 2>&1)" || {
    echo "$arch" >&2
    echo "e2e: $profile — arch:check без --strict не 0 после gen" >&2
    exit 1
  }
  if ! grep -q '^MAN-01 (предупреждение): ' <<<"$arch"; then
    echo "$arch" >&2
    echo "e2e: $profile — arch:check не вывел предупреждения MAN-01" >&2
    exit 1
  fi
  code=0
  arch="$(bun run arch:check --strict 2>&1)" || code=$?
  if [ "$code" -ne 1 ] || ! grep -q '^MAN-01: ' <<<"$arch"; then
    echo "$arch" >&2
    echo "e2e: $profile — arch:check --strict: код $code, ждали 1 и MAN-01" >&2
    exit 1
  fi
  # Ручных правок нет: UC вызывается по имени, контракт (D-45) — граница
  # TS-импортов между модулями, транспорту он не нужен.
  local out
  out="$(APP_DATA_DIR=data bun "$main" call todo.createTask \
    --user 5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6)"
  if ! grep -qE '^\{"ok":true,"value":\{"taskId":"[0-9a-f-]{36}"\}\}$' <<<"$out"; then
    echo "e2e: $profile — раннер вернул $out" >&2
    exit 1
  fi
  if ! grep -q '"op":"createTask"' data/oplog/*.jsonl; then
    echo "e2e: $profile — нет записи createTask в oplog" >&2
    exit 1
  fi
  run_logged "$WORK/$profile-check.log" "$profile — bun run check красный" \
    bun run check
  graph_e2e "$profile" "$name"
}

# Документ графа из каркаса: bun run graph детерминирован, узлы и рёбра
# с поставщиком, шапка dmg-core с видами, у UC — props.exposed (D-96).
graph_e2e() {
  local profile="$1" name="$2" first second
  run_logged "$WORK/$profile-graph.log" "$profile — bun run graph красный" \
    bun run graph
  first="$(sha256sum graph.json)"
  run_logged "$WORK/$profile-graph2.log" \
    "$profile — второй bun run graph красный" bun run graph
  second="$(sha256sum graph.json)"
  if [ "$first" != "$second" ]; then
    echo "e2e: $profile — graph.json различается между прогонами" >&2
    exit 1
  fi
  if [ "$(jq -r '.nodes[0].kind' graph.json)" != app ]; then
    echo "e2e: $profile — первый узел graph.json не вида app: $(jq -c '.nodes[0]' graph.json)" >&2
    exit 1
  fi
  if [ "$(jq '[.nodes[], .edges[]] | map(select(.provider == null)) | length' graph.json)" != 0 ]; then
    echo "e2e: $profile — в graph.json есть узлы или рёбра без provider" >&2
    exit 1
  fi
  if ! jq -e '[.providers[]? | select(.name == "dmg-core") | has("nodeKinds") and has("edgeKinds")] | any' graph.json >/dev/null; then
    echo "e2e: $profile — в шапке graph.json у поставщика dmg-core нет nodeKinds и edgeKinds" >&2
    exit 1
  fi
  if ! jq -e '[.nodes[] | select(.kind == "useCase")] | length > 0 and all(.props.exposed != null)' graph.json >/dev/null; then
    echo "e2e: $profile — у узлов useCase нет props.exposed" >&2
    exit 1
  fi
}

profile_e2e single src/runners/cli/main.ts acme src/platform/domain/acme.app.ts
profile_e2e monorepo runners/cli/src/main.ts @acme/school platform/domain/src/school.app.ts
echo "e2e: ok"
