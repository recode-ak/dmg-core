import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ProjectConfig } from '../gen/project-config';
import type { CliSettings } from './cli-config';
import { DirScan } from './dir-scan';
import { Marker } from './marker';
import type { PackageSet } from './package-set';

/**
 * Ожидаемая копия; markFile — файл, чья метка решает, наша ли копия
 * (у скила — его `SKILL.md`); marker — метка пакета-владельца копии.
 */
interface Copy {
  text: string;
  markFile: string;
  marker: Marker;
}

/** Найденное расхождение копии с пакетом */
export interface Finding {
  path: string;
  message: string;
}

/** Итог сверки проекта с пакетом (пути от корня проекта) */
export interface Inspection {
  /** Копии, которые надо записать (нет или расходится) */
  write: string[];
  /** Свои копии без источника — файлы и каталоги скилов */
  stale: string[];
  /** Файлы проекта на месте копий — не трогаются */
  foreign: string[];
  findings: Finding[];
}

/**
 * Доставка скилов и ролей поставки (`dmg-core` и поставщики) в проект по
 * настройкам: ожидаемые копии с меткой владельца, сверка с файлами проекта и
 * запись. Своими считаются файлы с меткой любого пакета: все метки ставит
 * `dmg-core sync`, поэтому копия убранного поставщика — своя без источника.
 */
export class Delivery {
  private readonly copies: Map<string, Copy>;

  constructor(
    private readonly packages: PackageSet,
    private readonly settings: CliSettings,
  ) {
    this.copies = this.build();
  }

  /** Сверяет файлы проекта в root с ожидаемыми копиями */
  async inspect(root: string): Promise<Inspection> {
    const result: Inspection = {
      write: [],
      stale: [],
      foreign: [],
      findings: [],
    };
    const read = (path: string) =>
      readFile(join(root, path), 'utf8').catch(() => undefined);

    for (const [path, copy] of this.copies) {
      const marked = await read(copy.markFile);
      if (marked !== undefined && Marker.of(marked) === undefined) {
        if (!result.foreign.includes(copy.markFile)) {
          result.foreign.push(copy.markFile);
          result.findings.push({
            path: copy.markFile,
            message: `файл не от dmg-core (удали его или исключи роль/скил в ${ProjectConfig.file})`,
          });
        }
        continue;
      }
      const actual = await read(path);
      if (actual === copy.text) continue;
      result.write.push(path);
      result.findings.push({ path, message: this.describe(actual, copy) });
    }

    for (const path of await this.staleCopies(root)) {
      result.stale.push(path);
      result.findings.push({ path, message: 'копия без источника' });
    }
    result.findings.sort((a, b) => a.path.localeCompare(b.path));
    return result;
  }

  /** Пишет недостающие и устаревшие копии, удаляет свои копии без источника */
  async apply(root: string, inspection: Inspection): Promise<void> {
    for (const path of inspection.write) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), this.copies.get(path)?.text ?? '');
    }
    for (const path of inspection.stale) {
      await rm(join(root, path), { recursive: true, force: true });
    }
  }

  /** Сменился владелец — в находке имена пакетов обеих меток */
  private describe(actual: string | undefined, copy: Copy): string {
    if (actual === undefined) return 'нет копии';
    const was = Marker.of(actual);
    const now = copy.marker;
    if (was !== undefined && was.name !== now.name) {
      return `устарела (${was.name}@${was.version} → ${now.name}@${now.version})`;
    }
    if (was !== undefined && was.version !== now.version) {
      return `устарела (${was.version} → ${now.version})`;
    }
    return 'расходится с пакетом (правлена руками?)';
  }

  private build(): Map<string, Copy> {
    const copies = new Map<string, Copy>();
    const { skills, roles } = this.settings;
    for (const dir of skills.dirs) {
      for (const name of skills.names) {
        const skill = this.packages.skill(name);
        if (!skill) continue;
        const markFile = `${dir}/${name}/SKILL.md`;
        const marker = skill.owner.marker();
        for (const [file, text] of skill.files) {
          copies.set(`${dir}/${name}/${file}`, {
            text: file.endsWith('.md') ? marker.mark(text) : text,
            markFile,
            marker,
          });
        }
      }
    }
    const selected = this.packages
      .roleNames()
      .filter((name) => roles.names.includes(name))
      .flatMap((name) => this.packages.role(name) ?? []);
    const { common } = this.packages;
    for (const target of roles.targets) {
      for (const { role, owner } of selected) {
        const path = `${target.dir}/${role.name}.md`;
        const marker = owner.marker();
        const text = role.render(target.format, marker, common);
        copies.set(path, { text, markFile: path, marker });
      }
      if (target.format === 'neutral') {
        // Общий блок один — `dmg-core`, с его меткой.
        const marker = this.packages.core.marker();
        copies.set(target.common, {
          text: marker.mark(common),
          markFile: target.common,
          marker,
        });
      }
    }
    return copies;
  }

  /** Свои копии (с меткой), которых нет среди ожидаемых */
  private async staleCopies(root: string): Promise<string[]> {
    const stale: string[] = [];
    const scan = new DirScan(root);
    const generated = async (path: string) =>
      Marker.of(await readFile(join(root, path), 'utf8').catch(() => '')) !==
      undefined;

    for (const target of this.settings.roles.targets) {
      for (const file of await scan.paths(target.dir, '*.md')) {
        const path = `${target.dir}/${file}`;
        if (!this.copies.has(path) && (await generated(path))) stale.push(path);
      }
    }
    for (const dir of this.settings.skills.dirs) {
      for (const file of await scan.paths(dir, '*/SKILL.md')) {
        const name = file.split('/')[0] ?? '';
        if (!(await generated(`${dir}/${file}`))) continue;
        if (!this.settings.skills.names.includes(name)) {
          stale.push(`${dir}/${name}`);
          continue;
        }
        for (const inner of await scan.paths(`${dir}/${name}`, '**/*')) {
          const path = `${dir}/${name}/${inner}`;
          if (!this.copies.has(path)) stale.push(path);
        }
      }
    }
    return stale;
  }
}
