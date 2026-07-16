import assert from 'node:assert';
import { test } from 'node:test';
import { SlotTypeRegistry } from '../slot-registry';

test('SlotTypeRegistry 注册并获取插槽', async () => {
  const registry = new SlotTypeRegistry();
  registry.register({
    name: 'transcode',
    configKey: 'transcode_max_concurrent',
    defaultMax: 2,
  });

  const acquired1 = await registry.acquire('transcode', 'task-1');
  const acquired2 = await registry.acquire('transcode', 'task-2');
  assert.strictEqual(acquired1, true);
  assert.strictEqual(acquired2, true);
  assert.strictEqual(registry.getRunning('transcode'), 2);
});

test('SlotTypeRegistry 超限时阻塞等待', async () => {
  const registry = new SlotTypeRegistry();
  registry.register({
    name: 'upload',
    configKey: 'upload_max_concurrent',
    defaultMax: 1,
  });

  await registry.acquire('upload', 'task-1');

  let resolved = false;
  const promise = registry.acquire('upload', 'task-2').then((r) => {
    resolved = true;
    return r;
  });

  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(resolved, false);

  registry.release('upload', 'task-1');
  const result = await promise;
  assert.strictEqual(result, true);
  assert.strictEqual(registry.getRunning('upload'), 1);
});

test('SlotTypeRegistry 取消排队中的请求', async () => {
  const registry = new SlotTypeRegistry();
  registry.register({
    name: 'transcode',
    configKey: 'transcode_max_concurrent',
    defaultMax: 1,
  });

  await registry.acquire('transcode', 'task-1');

  const promise = registry.acquire('transcode', 'task-2');
  const cancelled = registry.cancelAcquire('transcode', 'task-2');
  assert.strictEqual(cancelled, true);

  const result = await promise;
  assert.strictEqual(result, false);
});

test('SlotTypeRegistry 动态更新上限后自动启动排队任务', async () => {
  const registry = new SlotTypeRegistry();
  registry.register({
    name: 'upload',
    configKey: 'upload_max_concurrent',
    defaultMax: 1,
  });

  await registry.acquire('upload', 'task-1');

  let resolved = false;
  const promise = registry.acquire('upload', 'task-2').then((r) => {
    resolved = true;
    return r;
  });

  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(resolved, false);

  registry.updateMax('upload', 2);
  const result = await promise;
  assert.strictEqual(result, true);
});

test('SlotTypeRegistry 重复获取同一 key 返回 true', async () => {
  const registry = new SlotTypeRegistry();
  registry.register({
    name: 'transcode',
    configKey: 'transcode_max_concurrent',
    defaultMax: 1,
  });

  const r1 = await registry.acquire('transcode', 'task-1');
  const r2 = await registry.acquire('transcode', 'task-1');
  assert.strictEqual(r1, true);
  assert.strictEqual(r2, true);
  assert.strictEqual(registry.getRunning('transcode'), 1);
});

test('SlotTypeRegistry getAllStats 返回所有类型统计', async () => {
  const registry = new SlotTypeRegistry();
  registry.register({ name: 'a', configKey: 'a_max', defaultMax: 3 });
  registry.register({ name: 'b', configKey: 'b_max', defaultMax: 2 });

  await registry.acquire('a', 't1');
  await registry.acquire('a', 't2');
  await registry.acquire('b', 't1');

  const stats = registry.getAllStats();
  assert.strictEqual(stats.length, 2);

  const statA = stats.find((s) => s.name === 'a')!;
  assert.strictEqual(statA.running, 2);
  assert.strictEqual(statA.maxConcurrent, 3);

  const statB = stats.find((s) => s.name === 'b')!;
  assert.strictEqual(statB.running, 1);
  assert.strictEqual(statB.maxConcurrent, 2);
});

test('SlotTypeRegistry 未注册类型抛出错误', async () => {
  const registry = new SlotTypeRegistry();

  await assert.rejects(
    () => registry.acquire('unknown', 'task-1'),
    (err: Error) => err.message.includes('未注册的插槽类型'),
  );
});
