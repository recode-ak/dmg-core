# Поставка и публикация `dmg-core`

Реестр разработки пакета (в tarball не входит). Состояние на 2026-10-28: репо локальный (`~/dev/tools/dmg/dmg-core`, история перенесена `git subtree split` из u7-school), пушей и публикаций нет; u7-school подключает пакет как `file:` (D-55 u7-school). Рядом, в `~/dev/tools/dmg/`, появятся `dmg-ui` и другие пакеты DMG — поставка у них та же.

## Способы поставки

| Способ | Спецификатор у потребителя | Плюсы | Минусы |
|---|---|---|---|
| **git по тегу** (приватный GitHub) | `git+ssh://git@github.com/<owner>/dmg-core.git#v0.1.0` | одна строка — локально, на сервере, в новом проекте; версия — тег, коммит фиксирует `bun.lock`; без scope и токенов в `bunfig.toml` | на каждой машине — ssh-доступ (deploy key на сервере); semver-диапазонов нет — обновление правкой тега; ставится содержимое репо, а не tarball по `files` (проверить при релизе) |
| npm (публичный) | `"dmg-core": "^0.1.0"` | стандартно, semver, `files` и `bin` проверены `bun run e2e` (`npm publish --dry-run`) | код публичен; имя надо проверить (`npm view dmg-core` → 404 на 2026-10-26) |
| GitHub Packages | `"@<owner>/dmg-core": "^0.1.0"` | приватно, semver | обязателен scope → переименование импортов у потребителей; токен в `bunfig.toml` на каждой машине |
| свой registry (Verdaccio и т. п.) | `"dmg-core": "^0.1.0"` + `registry` в `bunfig.toml` | приватно, semver, без scope | сервис, который надо держать и бэкапить |
| tarball в репо потребителя | `file:./vendor/dmg-core-0.1.0.tgz` | без сети и ключей | двоичный файл в git на каждую версию, копия в каждом проекте |

**Рекомендация:** git по тегу (приватный GitHub) — сейчас, пока потребитель один-два проекта автора. npm — когда пакет станет нужен не только своим проектам (semver-диапазоны, публичная документация).

## Чек-лист первого релиза (git по тегу)

1. **Пакет готов:** `bun install && bun run check && bun run e2e` зелёные; `bun run docs:covers --strict` без предупреждений — документы с `covers:` не отстали от исходников (D-59); `version` в `package.json` равна будущему тегу; в `docs/decisions.md` и `debt.md` нет записей «до релиза».
2. **Репо на GitHub:** приватный `dmg-core`; поле `repository` в `package.json`; `git remote add origin git@github.com:<owner>/dmg-core.git`; `git push -u origin main`.
3. **Тег:** `git tag v0.1.0 && git push origin v0.1.0`.
4. **Проверка установки из git** (до замены у потребителя): пустой каталог → `bun add valibot @valibot/to-json-schema` → `bun add git+ssh://git@github.com/<owner>/dmg-core.git#v0.1.0` → `bunx dmg-core init --profile single` → `bun run check`. Проверить: работает `bin` `dmg-core`, плагины biome по пути `node_modules/dmg-core/biome-plugins/`, у пакета нет своей копии `valibot`, лишнее из репо (тесты, `scripts/`, `lint-fixtures/`) не мешает `tsc` и biome потребителя. Если мешает — поставка tarball из GitHub Releases или registry.
5. **u7-school:** во всех `package.json`, где объявлен `dmg-core`, `file:…` → `git+ssh://…#v0.1.0` (`git grep -l '"dmg-core": "file:'`); `bun install`; `bun run dmg:sync`; `bun run check`; коммит.
6. **Прод-сервер:** ssh-ключ сервера — deploy key репо `dmg-core` (только чтение); если на сервере несколько ключей GitHub — `Host`-алиас в `~/.ssh/config` и он же в спецификаторе; `bun install --frozen-lockfile` в `deploy.sh` клонирует пакет сам.
7. **CI** (по желанию, позже): `bun install` → `bun run check` → `bun run e2e` на push и теги.

## Обновление пакета у потребителя

1. Правка в репо пакета → `bun run check && bun run e2e` → коммит.
2. До релиза (`file:`): в проекте `bun install` (новые файлы подтягиваются только так) → `bun run dmg:sync` → `bun run check`.
3. После релиза: `version` в `package.json` → тег `vX.Y.Z` → push тега → в проекте замена `#vX.Y.Z` во всех `package.json` → `bun install` → `bun run dmg:sync` → `bun run check`.

## Переход на npm (когда понадобится)

1. `npm view dmg-core` → 404, иначе scope `@<owner>/dmg-core` и замена импортов у потребителей.
2. `bun run e2e` (в нём `npm publish --dry-run` и состав tarball) → `npm publish` по тегу (токен — в секретах CI).
3. У потребителей `git+ssh…#vX.Y.Z` → `"^X.Y.Z"`.
