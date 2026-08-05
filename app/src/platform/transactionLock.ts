// 所有数据操作最终都汇入 Rust 端的单一 sqlx 连接（db_execute / db_select）。
// 每条语句都是独立 IPC 调用，SQLite 事务跨多个 await 点时，事件循环可能
// 切到另一处也开启事务的代码，触发 "cannot start a transaction within a
// transaction" 或语句交错。database.ts 与 horizonDatabase.ts 历史上各自维护
// 一条序列化链，但两条链互不感知：一边的事务进行中，另一边的 BEGIN 仍可能
// 插入同一连接。统一导出同一个 JS 端异步互斥锁，让两个模块（以及未来任何
// 事务调用方）共享一条序列化链，从根上消除跨模块交错。
let transactionChain: Promise<unknown> = Promise.resolve()

export function withTransactionLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = transactionChain.then(operation, operation)
  // 链式等待，但隔离错误，避免单次失败阻塞后续所有事务
  transactionChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
