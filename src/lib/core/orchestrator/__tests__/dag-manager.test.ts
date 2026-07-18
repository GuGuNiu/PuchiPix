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

test('DAG 鏃犱緷璧栨椂閫€鍖栦负 FIFO', () => {
  const dag = new DagManager<Task>();
  const t1 = makeTask('a', '鎼滅储');
  const t2 = makeTask('b', '鐖彇');
  dag.addTask(t1);
  dag.addTask(t2);

  const candidates = [t1, t2];
  const next = dag.getNextExecutable(candidates);
  assert.strictEqual(next?.id, 'a');
});

test('DAG 渚濊禆灏辩华妫€娴?鈥?鍓嶇疆鏈畬鎴愭椂涓嶈繑鍥炲悗缁换鍔?, () => {
  const dag = new DagManager<Task>();
  const search = makeTask('search', '鎼滅储');
  const scrape = makeTask('scrape', '鐖彇', { dependsOn: ['search'] });
  dag.addTask(search);
  dag.addTask(scrape);

  const next = dag.getNextExecutable([scrape, search]);
  assert.strictEqual(next?.id, 'search');

  dag.markCompleted('search');
  const next2 = dag.getNextExecutable([scrape, search]);
  assert.strictEqual(next2?.id, 'scrape');
});

test('DAG 寰幆渚濊禆妫€娴?鈥?A鈫払鈫扖鈫扐', () => {
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

test('DAG 鑷惊鐜娴?鈥?A鈫扐', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));

  assert.throws(
    () => dag.addDependency('a', 'a'),
    (err: Error) => err instanceof DagCycleError,
  );
});

test('DAG 绾ц仈澶辫触 鈥?鍓嶇疆澶辫触鍚庡悗缁换鍔¤嚜鍔ㄥ彇娑?, () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '鎼滅储'));
  dag.addTask(makeTask('scrape', '鐖彇', { dependsOn: ['search'] }));
  dag.addTask(makeTask('download', '涓嬭浇', { dependsOn: ['scrape'] }));

  const cascaded = dag.markFailed('search');

  assert.strictEqual(cascaded.length, 2);
  assert.ok(cascaded.includes('scrape'));
  assert.ok(cascaded.includes('download'));
  assert.strictEqual(dag.areDependenciesMet('scrape'), false);
  assert.strictEqual(dag.areDependenciesMet('download'), false);
});

test('DAG markCompleted 杩斿洖鏂拌В閿佺殑浠诲姟', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '鎼滅储'));
  dag.addTask(makeTask('scrape', '鐖彇', { dependsOn: ['search'] }));
  dag.addTask(makeTask('download', '涓嬭浇', { dependsOn: ['search'] }));

  const unblocked = dag.markCompleted('search');
  assert.strictEqual(unblocked.length, 2);
  assert.ok(unblocked.includes('scrape'));
  assert.ok(unblocked.includes('download'));
});

test('DAG 浼樺厛绾ц皟搴?鈥?鍚屽氨缁换鍔′腑浼樺厛绾ч珮鑰呬紭鍏?, () => {
  const dag = new DagManager<Task>();
  const low = makeTask('low', '浣庝紭鍏堢骇', { priority: 1 });
  const high = makeTask('high', '楂樹紭鍏堢骇', { priority: 10 });
  dag.addTask(low);
  dag.addTask(high);

  const next = dag.getNextExecutable([low, high]);
  assert.strictEqual(next?.id, 'high');
});

test('DAG 鎷撴墤鎺掑簭杩斿洖姝ｇ‘鎵ц椤哄簭', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('download', '涓嬭浇', { dependsOn: ['scrape'] }));
  dag.addTask(makeTask('search', '鎼滅储'));
  dag.addTask(makeTask('scrape', '鐖彇', { dependsOn: ['search'] }));

  const sorted = dag.topologicalSort();
  const ids = sorted.map((t) => t.id);

  assert.ok(ids.indexOf('search') < ids.indexOf('scrape'));
  assert.ok(ids.indexOf('scrape') < ids.indexOf('download'));
});

test('DAG 娴佹按绾垮満鏅?鈥?鎼滅储鈫掔埇鍙栤啋涓嬭浇', () => {
  const dag = new DagManager<Task>();
  const search = makeTask('search', '鎼滅储');
  const scrape = makeTask('scrape', '鐖彇', { dependsOn: ['search'] });
  const download = makeTask('download', '涓嬭浇', { dependsOn: ['scrape'] });
  dag.addTask(search);
  dag.addTask(scrape);
  dag.addTask(download);

  assert.strictEqual(dag.getNextExecutable([download, scrape, search])?.id, 'search');

  dag.markCompleted('search');
  assert.strictEqual(dag.getNextExecutable([download, scrape, search])?.id, 'scrape');

  dag.markCompleted('scrape');
  assert.strictEqual(dag.getNextExecutable([download, scrape, search])?.id, 'download');
});

test('DAG 澶氬墠缃緷璧?鈥?鍏ㄩ儴瀹屾垚鍚庢墠鍙墽琛?, () => {
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

test('DAG addDependency 瀵规湭娉ㄥ唽鐨勪緷璧栨柟鎶涘嚭閿欒', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));

  assert.throws(
    () => dag.addDependency('nonexistent', 'a'),
    (err: Error) => err instanceof DagTaskNotFoundError,
  );
});

test('DAG 缁熻淇℃伅', () => {
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

// 鈹€鈹€鈹€ 鏂板娴嬭瘯锛欿ahn 绠楁硶 + readySet + removeTask + 鍗犱綅瀹夊叏 鈹€鈹€鈹€

test('DAG 寰幆渚濊禆妫€娴?鈥?Kahn 绠楁硶妫€娴嬪埌鐜矾骞惰繑鍥炶矾寰?, () => {
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

test('DAG 娣卞眰渚濊禆閾句笉鏍堟孩鍑?鈥?Kahn 杩唬绠楁硶', () => {
  const dag = new DagManager<Task>();
  const depth = 5000;

  for (let i = 0; i < depth; i++) {
    dag.addTask(makeTask(i, `Task-${i}`));
    if (i > 0) {
      dag.addDependency(i, i - 1);
    }
  }

  // 濡傛灉閫掑綊 DFS 浼氭爤婧㈠嚭锛孠ahn 杩唬绠楁硶涓嶄細
  dag.detectCycles();

  const sorted = dag.topologicalSort();
  assert.strictEqual(sorted.length, depth);
  assert.strictEqual(sorted[0].id, 0);
  assert.strictEqual(sorted[depth - 1].id, depth - 1);
});

test('DAG readySet 澧為噺灏辩华 鈥?markCompleted 鍚?readySet 姝ｇ‘鏇存柊', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '鎼滅储'));
  dag.addTask(makeTask('scrape', '鐖彇', { dependsOn: ['search'] }));

  const stats1 = dag.getStats();
  assert.strictEqual(stats1.readyCount, 1);

  dag.markCompleted('search');
  const stats2 = dag.getStats();
  assert.strictEqual(stats2.readyCount, 1);
  assert.strictEqual(stats2.completedCount, 1);
});

test('DAG removeTask 鈥?绉婚櫎鍚庝换鍔′笉鍐嶅嚭鐜板湪 DAG 涓?, () => {
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

test('DAG removeTask 鈥?娓呯悊渚濊禆杈瑰悗鍚庣画浠诲姟鐨勪緷璧栧垪琛ㄦ洿鏂?, () => {
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

test('DAG removeTask 鈥?绉婚櫎澶辫触浠诲姟鍚庣骇鑱旂姸鎬佹竻鐞?, () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('search', '鎼滅储'));
  dag.addTask(makeTask('scrape', '鐖彇', { dependsOn: ['search'] }));
  dag.addTask(makeTask('download', '涓嬭浇', { dependsOn: ['scrape'] }));

  dag.markFailed('search');
  assert.strictEqual(dag.getStats().cascadedCount, 2);

  dag.removeTask('search');
  dag.removeTask('scrape');
  dag.removeTask('download');

  assert.strictEqual(dag.getStats().taskCount, 0);
  assert.strictEqual(dag.getStats().failedCount, 0);
  assert.strictEqual(dag.getStats().cascadedCount, 0);
});

test('DAG 鍗犱綅浠诲姟妫€娴?鈥?addDependency 鍒涘缓鍗犱綅鍚?addTask 鍗囩骇', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));

  // 'b' 鏈敞鍐岋紝addDependency 鑷姩鍒涘缓鍗犱綅
  dag.addDependency('a', 'b');
  assert.strictEqual(dag.isPlaceholder('b'), true);
  assert.strictEqual(dag.getTask('b')?.id, 'b');

  // 姝ｅ紡娉ㄥ唽 'b'锛屼粠鍗犱綅鍗囩骇
  dag.addTask(makeTask('b', 'B'));
  assert.strictEqual(dag.isPlaceholder('b'), false);
  assert.strictEqual(dag.getTask('b')?.id, 'b');
});

test('DAG DagStats readyCount 鈥?缁熻灏辩华浠诲姟鏁?, () => {
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

test('DAG markFailed 浠?readySet 绉婚櫎绾ц仈浠诲姟', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B', { dependsOn: ['a'] }));

  assert.strictEqual(dag.getStats().readyCount, 1);

  dag.markFailed('a');
  assert.strictEqual(dag.getStats().readyCount, 0);
  assert.strictEqual(dag.getStats().failedCount, 1);
  assert.strictEqual(dag.getStats().cascadedCount, 1);
});

test('DAG addDependency 鍚庝换鍔′粠 readySet 绉婚櫎', () => {
  const dag = new DagManager<Task>();
  dag.addTask(makeTask('a', 'A'));
  dag.addTask(makeTask('b', 'B'));

  assert.strictEqual(dag.getStats().readyCount, 2);

  // b 鐜板湪渚濊禆 a锛宎 鏈畬鎴愶紝b 浠?readySet 绉婚櫎
  dag.addDependency('b', 'a');
  assert.strictEqual(dag.getStats().readyCount, 1);
});

test('DAG clear 娓呴櫎鎵€鏈夌姸鎬佸惈 readySet 鍜?placeholders', () => {
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
