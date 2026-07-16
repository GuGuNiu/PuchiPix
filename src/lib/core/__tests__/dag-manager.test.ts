import assert from 'node:assert';
import { test } from 'node:test';
import {
  DagManager,
  DagCycleError,
  DagTaskNotFoundError,
  type DagCapableTask,
} from '../dag-manager';

type Task = DagCapableTask & { name: string };

function makeTask(id: string | number, name: string, extra?: Partial<Task>): Task {
  return { id, name, ...extra };
}

test('DAG 无依赖时退化为 FIFO', () => {
  const dag = new DagManager<Task>();
  const t1 = makeTask('a', '搜索');
  const t2 = makeTask('b', '爬取');
  dag.addTask(t1);
  dag.addTask(t2);

  const candidates = [t1, t2];
  const next = dag.getNextExecutable(candidates);
  assert.strictEqual(next?.id, 'a');
});

test('DAG 依赖就绪检测 — 前置未完成时不返回后续任务', () => {
  const dag = new DagManager<Task>();
  const search = makeTask('search', '搜索');
  const scrape = makeTask('scrape', '爬取', { dependsOn: ['search'] });
  dag.addTask(search);
  dag.addTask(scrape);

  const next = dag.getNextExecutable([scrape, search]);
  assert.strictEqual(next?.id, 'search');

  dag.markCompleted('search');
  const next2 = dag.getNextExecutable([scrape, search]);
  assert.strictEqual(next2?.id, 'scrape');
});

test('DAG 循环依赖检测 — A→B→C→A', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B'));
  dag.addTask(makeTask('c', 'C'));
  dag.addDependency('b', 'a');
  dag.addDependency('c', 'b');
  dag.addDependency('a', 'c');

  assert.throws(
    () => dag.detectCycles(),
    (err: Error) => err instanceof DagCycleError,
  );
});

test('DAG 自循环检测 — A→A', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));

  assert.throws(
    () => dag.addDependency('a', 'a'),
    (err: Error) => err instanceof DagCycleError,
  );
});

test('DAG 级联失败 — 前置失败后后续任务自动取消', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '搜索'));
  dag.addTask(makeTask('scrape', '爬取', { dependsOn: ['search'] }));
  dag.addTask(makeTask('download', '下载', { dependsOn: ['scrape'] }));

  const cascaded = dag.markFailed('search');

  assert.strictEqual(cascaded.length, 2);
  assert.ok(cascaded.includes('scrape'));
  assert.ok(cascaded.includes('download'));
  assert.strictEqual(dag.areDependenciesMet('scrape'), false);
  assert.strictEqual(dag.areDependenciesMet('download'), false);
});

test('DAG markCompleted 返回新解锁的任务', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '搜索'));
  dag.addTask(makeTask('scrape', '爬取', { dependsOn: ['search'] }));
  dag.addTask(makeTask('download', '下载', { dependsOn: ['search'] }));

  const unblocked = dag.markCompleted('search');
  assert.strictEqual(unblocked.length, 2);
  assert.ok(unblocked.includes('scrape'));
  assert.ok(unblocked.includes('download'));
});

test('DAG 优先级调度 — 同就绪任务中优先级高者优先', () => {
  const dag = new DagManager<Task>();
  const low = makeTask('low', '低优先级', { priority: 1 });
  const high = makeTask('high', '高优先级', { priority: 10 });
  dag.addTask(low);
  dag.addTask(high);

  const next = dag.getNextExecutable([low, high]);
  assert.strictEqual(next?.id, 'high');
});

test('DAG 拓扑排序返回正确执行顺序', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('download', '下载', { dependsOn: ['scrape'] }));
  dag.addTask(makeTask('search', '搜索'));
  dag.addTask(makeTask('scrape', '爬取', { dependsOn: ['search'] }));

  const sorted = dag.topologicalSort();
  const ids = sorted.map((t) => t.id);

  assert.ok(ids.indexOf('search') < ids.indexOf('scrape'));
  assert.ok(ids.indexOf('scrape') < ids.indexOf('download'));
});

test('DAG 流水线场景 — 搜索→爬取→下载', () => {
  const dag = new DagManager<Task>();
  const search = makeTask('search', '搜索');
  const scrape = makeTask('scrape', '爬取', { dependsOn: ['search'] });
  const download = makeTask('download', '下载', { dependsOn: ['scrape'] });
  dag.addTask(search);
  dag.addTask(scrape);
  dag.addTask(download);

  assert.strictEqual(dag.getNextExecutable([download, scrape, search])?.id, 'search');

  dag.markCompleted('search');
  assert.strictEqual(dag.getNextExecutable([download, scrape, search])?.id, 'scrape');

  dag.markCompleted('scrape');
  assert.strictEqual(dag.getNextExecutable([download, scrape, search])?.id, 'download');
});

test('DAG 多前置依赖 — 全部完成后才可执行', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B'));
  dag.addTask(makeTask('c', 'C', { dependsOn: ['a', 'b'] }));

  assert.strictEqual(dag.areDependenciesMet('c'), false);

  dag.markCompleted('a');
  assert.strictEqual(dag.areDependenciesMet('c'), false);

  dag.markCompleted('b');
  assert.strictEqual(dag.areDependenciesMet('c'), true);
});

test('DAG addDependency 对未注册的依赖方抛出错误', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));

  assert.throws(
    () => dag.addDependency('nonexistent', 'a'),
    (err: Error) => err instanceof DagTaskNotFoundError,
  );
});

test('DAG 统计信息', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B', { dependsOn: ['a'] }));
  dag.markCompleted('a');
  dag.markFailed('b');

  const stats = dag.getStats();
  assert.strictEqual(stats.taskCount, 2);
  assert.strictEqual(stats.completedCount, 1);
  assert.strictEqual(stats.failedCount, 1);
});

// ─── 新增测试：Kahn 算法 + readySet + removeTask + 占位安全 ───

test('DAG 循环依赖检测 — Kahn 算法检测到环路并返回路径', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('x', 'X'));
  dag.addTask(makeTask('y', 'Y'));
  dag.addTask(makeTask('z', 'Z'));
  dag.addDependency('y', 'x');
  dag.addDependency('z', 'y');
  dag.addDependency('x', 'z');

  assert.throws(
    () => dag.detectCycles(),
    (err: unknown) => {
      assert.ok(err instanceof DagCycleError);
      assert.ok(err.cyclePath.length >= 3);
      return true;
    },
  );
});

test('DAG 深层依赖链不栈溢出 — Kahn 迭代算法', () => {
  const dag = new DagManager<Task>();
  const depth = 5000;

  for (let i = 0; i < depth; i++) {
    dag.addTask(makeTask(i, `Task-${i}`));
    if (i > 0) {
      dag.addDependency(i, i - 1);
    }
  }

  // 如果递归 DFS 会栈溢出，Kahn 迭代算法不会
  dag.detectCycles();

  const sorted = dag.topologicalSort();
  assert.strictEqual(sorted.length, depth);
  assert.strictEqual(sorted[0].id, 0);
  assert.strictEqual(sorted[depth - 1].id, depth - 1);
});

test('DAG readySet 增量就绪 — markCompleted 后 readySet 正确更新', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '搜索'));
  dag.addTask(makeTask('scrape', '爬取', { dependsOn: ['search'] }));

  const stats1 = dag.getStats();
  assert.strictEqual(stats1.readyCount, 1);

  dag.markCompleted('search');
  const stats2 = dag.getStats();
  assert.strictEqual(stats2.readyCount, 1);
  assert.strictEqual(stats2.completedCount, 1);
});

test('DAG removeTask — 移除后任务不再出现在 DAG 中', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B', { dependsOn: ['a'] }));
  dag.markCompleted('a');

  assert.strictEqual(dag.getTask('a')?.id, 'a');

  dag.removeTask('a');

  assert.strictEqual(dag.getTask('a'), undefined);
  assert.strictEqual(dag.isCompleted('a'), false);

  const stats = dag.getStats();
  assert.strictEqual(stats.taskCount, 1);
  assert.strictEqual(stats.completedCount, 0);
});

test('DAG removeTask — 清理依赖边后后续任务的依赖列表更新', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B', { dependsOn: ['a'] }));
  dag.addTask(makeTask('c', 'C', { dependsOn: ['a', 'b'] }));

  dag.markCompleted('a');
  dag.markCompleted('b');
  dag.removeTask('a');

  assert.strictEqual(dag.areDependenciesMet('c'), true);
  assert.strictEqual(dag.getStats().taskCount, 2);
});

test('DAG removeTask — 移除失败任务后级联状态清理', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '搜索'));
  dag.addTask(makeTask('scrape', '爬取', { dependsOn: ['search'] }));
  dag.addTask(makeTask('download', '下载', { dependsOn: ['scrape'] }));

  dag.markFailed('search');
  assert.strictEqual(dag.getStats().cascadedCount, 2);

  dag.removeTask('search');
  dag.removeTask('scrape');
  dag.removeTask('download');

  assert.strictEqual(dag.getStats().taskCount, 0);
  assert.strictEqual(dag.getStats().failedCount, 0);
  assert.strictEqual(dag.getStats().cascadedCount, 0);
});

test('DAG 占位任务检测 — addDependency 创建占位后 addTask 升级', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));

  // 'b' 未注册，addDependency 自动创建占位
  dag.addDependency('a', 'b');
  assert.strictEqual(dag.isPlaceholder('b'), true);
  assert.strictEqual(dag.getTask('b')?.id, 'b');

  // 正式注册 'b'，从占位升级
  dag.addTask(makeTask('b', 'B'));
  assert.strictEqual(dag.isPlaceholder('b'), false);
  assert.strictEqual(dag.getTask('b')?.id, 'b');
});

test('DAG DagStats readyCount — 统计就绪任务数', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B'));
  dag.addTask(makeTask('c', 'C', { dependsOn: ['a', 'b'] }));

  const stats1 = dag.getStats();
  assert.strictEqual(stats1.readyCount, 2);

  dag.markCompleted('a');
  const stats2 = dag.getStats();
  assert.strictEqual(stats2.readyCount, 1);

  dag.markCompleted('b');
  const stats3 = dag.getStats();
  assert.strictEqual(stats3.readyCount, 1);
});

test('DAG markFailed 从 readySet 移除级联任务', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B', { dependsOn: ['a'] }));

  assert.strictEqual(dag.getStats().readyCount, 1);

  dag.markFailed('a');
  assert.strictEqual(dag.getStats().readyCount, 0);
  assert.strictEqual(dag.getStats().failedCount, 1);
  assert.strictEqual(dag.getStats().cascadedCount, 1);
});

test('DAG addDependency 后任务从 readySet 移除', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B'));

  assert.strictEqual(dag.getStats().readyCount, 2);

  // b 现在依赖 a，a 未完成，b 从 readySet 移除
  dag.addDependency('b', 'a');
  assert.strictEqual(dag.getStats().readyCount, 1);
});

test('DAG clear 清除所有状态含 readySet 和 placeholders', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addDependency('a', 'b');
  dag.markCompleted('a');

  dag.clear();

  const stats = dag.getStats();
  assert.strictEqual(stats.taskCount, 0);
  assert.strictEqual(stats.readyCount, 0);
  assert.strictEqual(stats.completedCount, 0);
});
