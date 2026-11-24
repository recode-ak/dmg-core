import { describe, expect, it } from 'bun:test';
import type { GraphProvider } from '../graph/graph-provider';
import type { SourceLayer } from '../graph/source-layer.types';
import { ExampleAppDef } from '../testing/example/platform/domain/example.app';
import {
  LayerProvider,
  NoteWithoutChildrenRule,
  RuleProvider,
  StubRule,
  TOY_NODE,
  toyRuleProvider,
} from './arch.fixture';
import { ProviderRuleChecker } from './provider-rule-checker';

const lines = (checker: ProviderRuleChecker) =>
  checker.check().map((v) => v.format());

/** Сообщение исключения конструктора. */
function refusal(providers: readonly GraphProvider[]): string {
  try {
    new ProviderRuleChecker({ def: ExampleAppDef, providers });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'не бросил';
}

describe('ProviderRuleChecker: проверка графа', () => {
  it('правило получает граф приложения: корень example и узел toy', () => {
    const rule = new StubRule('TOY-01');
    const toy = new RuleProvider('toy', [rule], [TOY_NODE]);
    new ProviderRuleChecker({ def: ExampleAppDef, providers: [toy] }).check();
    expect(rule.graphs).toHaveLength(1);
    const [graph] = rule.graphs;
    expect(graph?.node('example')?.kind).toBe('app');
    expect(graph?.node('example/toy')?.provider).toBe('toy');
  });

  it('сообщение правила — нарушение с ID правила', () => {
    const toy = toyRuleProvider();
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [toy],
    });
    expect(lines(checker)).toEqual([
      'TOY-01: заметка example/toy без вложений',
    ]);
    expect(checker.check()[0]?.rule).toBe('TOY-01');
  });

  it('правило ничего не вернуло — нарушений нет', () => {
    const toy = new RuleProvider(
      'toy',
      [new StubRule('TOY-01', [])],
      [TOY_NODE],
    );
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [toy],
    });
    expect(checker.check()).toEqual([]);
  });

  it('поставщик без rules: граф не строится', () => {
    const plain = new RuleProvider('plain', undefined, [TOY_NODE]);
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [plain],
    });
    expect(checker.check()).toEqual([]);
    expect(plain.contributed).toBe(0);
  });

  it('порядок: поставщики, правила, сообщения; граф один на все правила', () => {
    const first = new StubRule('TOY-01', ['a', 'b']);
    const second = new StubRule('TOY-02', ['c']);
    const third = new StubRule('RIV-01', ['d']);
    const toy = new RuleProvider('toy', [first, second], [TOY_NODE]);
    const rival = new RuleProvider('rival', [third]);
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [toy, rival],
    });
    expect(lines(checker)).toEqual([
      'TOY-01: a',
      'TOY-01: b',
      'TOY-02: c',
      'RIV-01: d',
    ]);
    expect(second.graphs[0]).toBe(first.graphs[0]);
    expect(third.graphs[0]).toBe(first.graphs[0]);
    expect(toy.contributed).toBe(1);
  });

  it('повторный check() граф заново не строит', () => {
    const toy = toyRuleProvider();
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [toy],
    });
    expect(lines(checker)).toEqual(lines(checker));
    expect(toy.contributed).toBe(1);
  });

  it('граф не собран: нарушение ARC-13, правила не вызваны', () => {
    const rule = new StubRule('RIV-01', ['не должно быть']);
    const clash = new RuleProvider('dmg-core', [rule]);
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [clash],
    });
    const [line, ...rest] = lines(checker);
    expect(line).toStartWith(
      'ARC-13: граф приложения example не собран, правила поставщиков не проверены — ',
    );
    expect(line?.endsWith('— ')).toBe(false);
    expect(rest).toEqual([]);
    expect(rule.graphs).toEqual([]);
  });

  it('граф не собран из-за узла с неизвестным родителем: то же нарушение', () => {
    const rule = new StubRule('TOY-01', ['не должно быть']);
    const orphan = { ...TOY_NODE, id: 'example/missing/toy' };
    const toy = new RuleProvider('toy', [rule], [orphan]);
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [toy],
    });
    const [line] = lines(checker);
    expect(line).toStartWith(
      'ARC-13: граф приложения example не собран, правила поставщиков не проверены — ',
    );
    expect(rule.graphs).toEqual([]);
  });

  it('исключение внутри правила пробрасывается', () => {
    const broken = {
      id: 'TOY-01',
      check: (): readonly string[] => {
        throw new Error('дефект правила');
      },
    };
    const toy = new RuleProvider('toy', [broken], [TOY_NODE]);
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [toy],
    });
    expect(() => checker.check()).toThrow('дефект правила');
  });
});

describe('ProviderRuleChecker: ID правил (ARC-13)', () => {
  it('ID не по форме — отказ', () => {
    expect(refusal([new RuleProvider('toy', [new StubRule('toy-1')])])).toBe(
      'ARC-13: правило toy-1 поставщика toy — ID не по форме <ПРЕФИКС>-<NN>',
    );
  });

  it('префикс пакета у поставщика — отказ', () => {
    expect(refusal([new RuleProvider('toy', [new StubRule('MAN-01')])])).toBe(
      'ARC-13: правило MAN-01 поставщика toy — префикс MAN занят правилами пакета dmg-core',
    );
  });

  it('префикс у двух поставщиков — отказ', () => {
    const toy = new RuleProvider('toy', [new StubRule('TOY-01')]);
    const rival = new RuleProvider('rival', [new StubRule('TOY-02')]);
    expect(refusal([toy, rival])).toBe(
      'ARC-13: префикс TOY у двух поставщиков — toy и rival',
    );
  });

  it('один ID дважды у поставщика — отказ', () => {
    const toy = new RuleProvider('toy', [
      new NoteWithoutChildrenRule(),
      new StubRule('TOY-01'),
    ]);
    expect(refusal([toy])).toBe(
      'ARC-13: правило TOY-01 поставщика toy объявлено дважды',
    );
  });

  it('несколько правил одного префикса у одного поставщика — допустимо', () => {
    const toy = new RuleProvider('toy', [
      new StubRule('TOY-01'),
      new StubRule('TOY-02'),
    ]);
    expect(refusal([toy])).toBe('не бросил');
  });
});

describe('ProviderRuleChecker: ID слоёв поставщика (ARC-13)', () => {
  const layer = (rule: string): SourceLayer => ({
    name: 'views',
    axis: 'runner',
    rule,
    sees: [{ layer: 'kernel' }],
  });

  it('ID слоя не по форме — отказ', () => {
    expect(refusal([new LayerProvider('toy', [layer('toy-2')])])).toBe(
      'ARC-13: слой views поставщика toy — ID toy-2 не по форме <ПРЕФИКС>-<NN>',
    );
  });

  it('префикс пакета у слоя — отказ', () => {
    expect(refusal([new LayerProvider('toy', [layer('ARC-02')])])).toBe(
      'ARC-13: слой views поставщика toy — префикс ARC занят правилами пакета dmg-core',
    );
  });

  it('префикс слоя занят правилом другого поставщика — отказ', () => {
    const toy = new RuleProvider('toy', [new StubRule('TOY-01')]);
    const rival = new LayerProvider('rival', [layer('TOY-02')]);
    expect(refusal([toy, rival])).toBe(
      'ARC-13: префикс TOY у двух поставщиков — toy и rival',
    );
  });

  it('ID слоя совпал с ID правила того же поставщика — отказ', () => {
    const toy = new LayerProvider(
      'toy',
      [layer('TOY-01')],
      [new StubRule('TOY-01')],
    );
    expect(refusal([toy])).toBe(
      'ARC-13: слой views поставщика toy — ID TOY-01 объявлен дважды',
    );
  });

  it('два слоя одного поставщика с одним ID — допустимо, как ARC-02 у kernel и domain', () => {
    const toy = new LayerProvider('toy', [
      layer('TOY-02'),
      { ...layer('TOY-02'), name: 'pages' },
    ]);
    expect(refusal([toy])).toBe('не бросил');
  });

  it('правило SCR-01 и слой SCR-02 одного поставщика — допустимо', () => {
    const screen = new LayerProvider(
      'screen',
      [layer('SCR-02')],
      [new StubRule('SCR-01')],
    );
    expect(refusal([screen])).toBe('не бросил');
  });
});

describe('ProviderRuleChecker: ID доступа слоя поставщика (ARC-13)', () => {
  const layer = (over: Partial<SourceLayer> = {}): SourceLayer => ({
    name: 'views',
    axis: 'runner',
    rule: 'TOY-02',
    sees: [{ layer: 'kernel' }],
    ...over,
  });
  const seesWith = (rule: string, to = 'kernel'): SourceLayer =>
    layer({ sees: [{ layer: to, rule }] });

  it('ID доступа не по форме — отказ', () => {
    expect(refusal([new LayerProvider('toy', [seesWith('toy-3')])])).toBe(
      'ARC-13: доступ sees kernel слоя views поставщика toy — ID toy-3 не по форме <ПРЕФИКС>-<NN>',
    );
  });

  it('префикс пакета у доступа — отказ', () => {
    expect(
      refusal([new LayerProvider('toy', [seesWith('ARC-04', 'domain')])]),
    ).toBe(
      'ARC-13: доступ sees domain слоя views поставщика toy — префикс ARC занят правилами пакета dmg-core',
    );
  });

  it('префикс доступа занят правилом другого поставщика — отказ', () => {
    const toy = new RuleProvider('toy', [new StubRule('TOY-01')]);
    const rival = new LayerProvider('rival', [
      layer({ rule: 'RIV-02', sees: [{ layer: 'kernel', rule: 'TOY-03' }] }),
    ]);
    expect(refusal([toy, rival])).toBe(
      'ARC-13: префикс TOY у двух поставщиков — toy и rival',
    );
  });

  it('ID доступа совпал с ID правила того же поставщика — отказ', () => {
    const toy = new LayerProvider(
      'toy',
      [seesWith('TOY-01')],
      [new StubRule('TOY-01')],
    );
    expect(refusal([toy])).toBe(
      'ARC-13: доступ sees kernel слоя views поставщика toy — ID TOY-01 объявлен дважды',
    );
  });

  it('ID доступа в seenBy сверяется так же', () => {
    const toy = new LayerProvider('toy', [
      layer({ seenBy: [{ layer: 'runner', rule: 'toy-4' }] }),
    ]);
    expect(refusal([toy])).toBe(
      'ARC-13: доступ seenBy runner слоя views поставщика toy — ID toy-4 не по форме <ПРЕФИКС>-<NN>',
    );
  });

  it('ID доступа со своим префиксом — допустимо, как у слоя', () => {
    const toy = new LayerProvider(
      'toy',
      [
        layer({
          sees: [{ layer: 'kernel', rule: 'TOY-03' }],
          seenBy: [{ layer: 'runner', rule: 'TOY-03' }],
        }),
      ],
      [new StubRule('TOY-01')],
    );
    expect(refusal([toy])).toBe('не бросил');
  });
});

describe('ProviderRuleChecker: отступление доступа (ARC-13)', () => {
  const layer = (over: Partial<SourceLayer> = {}): SourceLayer => ({
    name: 'views',
    axis: 'runner',
    rule: 'TOY-02',
    sees: [{ layer: 'kernel' }],
    ...over,
  });

  it('debt у доступа без своего rule — отказ', () => {
    expect(
      refusal([
        new LayerProvider('toy', [
          layer({ sees: [{ layer: 'kernel', debt: true }] }),
        ]),
      ]),
    ).toBe(
      'ARC-13: доступ sees kernel слоя views поставщика toy — debt без своего rule',
    );
    expect(
      refusal([
        new LayerProvider('toy', [
          layer({ seenBy: [{ layer: 'runner', debt: true }] }),
        ]),
      ]),
    ).toBe(
      'ARC-13: доступ seenBy runner слоя views поставщика toy — debt без своего rule',
    );
  });

  it('ID с debt делят доступ с debt и слой или доступ без него — отказ', () => {
    // Порядок обхода: слой, затем его доступы; отказ — у второго из пары.
    const shared = (detail: string, id: string): string =>
      `ARC-13: ${detail} поставщика toy — ID ${id} делят доступ с debt и слой или доступ без него`;
    expect(
      refusal([
        new LayerProvider('toy', [
          layer({ sees: [{ layer: 'kernel', rule: 'TOY-02', debt: true }] }),
        ]),
      ]),
    ).toBe(shared('доступ sees kernel слоя views', 'TOY-02'));
    expect(
      refusal([
        new LayerProvider('toy', [
          layer({
            sees: [
              { layer: 'kernel', rule: 'TOY-03', debt: true },
              { layer: 'domain', rule: 'TOY-03' },
            ],
          }),
        ]),
      ]),
    ).toBe(shared('доступ sees domain слоя views', 'TOY-03'));
    expect(
      refusal([
        new LayerProvider('toy', [
          layer({ sees: [{ layer: 'kernel', rule: 'TOY-03', debt: true }] }),
          layer({ name: 'pages', rule: 'TOY-03' }),
        ]),
      ]),
    ).toBe(shared('слой pages', 'TOY-03'));
    // Допустимо: доступы с debt делят ID, в том числе в seenBy.
    const checker = new ProviderRuleChecker({
      def: ExampleAppDef,
      providers: [
        new LayerProvider('toy', [
          layer({
            sees: [{ layer: 'kernel', rule: 'TOY-03', debt: true }],
            seenBy: [{ layer: 'runner', rule: 'TOY-03', debt: true }],
          }),
        ]),
      ],
    });
    expect(checker.debtIds).toEqual(new Set(['TOY-03']));
  });
});
