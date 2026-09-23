class MyPromise {
    #PromiseState = 'pending';
    #PromiseResult = null;

    constructor(executor) {
        const resolve = (value) => {
            if(this.#PromiseState !== 'pending'){
                return;
            }
           this.#PromiseState = 'fulfilled';
           this.#PromiseResult = value;
           return new MyPromise((resolve, reject) => {
               resolve(this.#PromiseResult);
           }, reject);
        };
        const reject = (reason) => {
            if(this.#PromiseState !== 'pending'){
                return;
            }
            this.#PromiseState = 'rejected';
            this.#PromiseResult = reason;
            return this;
        };
        executor(resolve,reject);
    }
    then(onFulfilled,onRejected){
        if(this.#PromiseState === 'fulfilled'){
            onFulfilled(this.#PromiseResult);
        }
        if(onRejected && this.#PromiseState === 'rejected'){
            onRejected(this.#PromiseResult);
        }
        return this;
    }
}
MyPromise.all = function (promises) {
    return new MyPromise((resolve, reject) => {
        const list = Array.from(promises);   // 兼容任意可迭代对象 + 类数组
        let count = 0;
        const results = [];
        list.forEach((promise, index) => {
            promise.then((value) => {
                results[index] = value;
                count++;
                if (count === list.length) resolve(results);
            }, reject);                      // 顺带一提：then 第二参直接传 reject 更简洁
        });
    });
};
MyPromise.race = function(promises){
    return new MyPromise((resolve,reject) => {
        const list = Array.from(promises);   // 兼容任意可迭代对象 + 类数组
        list.forEach((promise) => {
            promise.then((value) => {
                resolve(value);
            }).catch((reason) => {
                reject(reason);
            })
        })
    })
}
// 手写Promise构造函数（符合Promise A+规范）
class MyPromise1 {
    // 私有字段：状态、结果、回调队列
    #PromiseState = 'pending';
    #PromiseResult = undefined;
    #fulfilledCallbacks = []; // 存储pending状态下的onFulfilled回调
    #rejectedCallbacks = [];   // 存储pending状态下的onRejected回调

    constructor(executor) {
        // resolve方法：状态转换为fulfilled
        const resolve = (value) => {
            // 禁止循环引用：不能resolve自身
            if (value === this) {
                throw new TypeError('Chaining cycle detected for promise');
            }
            // 处理thenable（Promise或带then方法的对象）
            if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
                // 递归解析thenable的状态
                value.then(resolve, reject);
                return;
            }
            // 仅pending状态允许转换
            if (this.#PromiseState !== 'pending') return;
            this.#PromiseState = 'fulfilled';
            this.#PromiseResult = value;
            // 异步执行回调队列（模拟微任务）
            this.#runCallbacks();
        };

        // reject方法：状态转换为rejected
        const reject = (reason) => {
            // 仅pending状态允许转换
            if (this.#PromiseState !== 'pending') return;
            this.#PromiseState = 'rejected';
            this.#PromiseResult = reason;
            // 异步执行回调队列
            this.#runCallbacks();
        };

        // 立即同步执行executor，捕获异常直接触发reject
        try {
            executor(resolve, reject);
        } catch (e) {
            reject(e);
        }
    }

    // 私有方法：执行存储的回调队列
    #runCallbacks() {
        // 用setTimeout模拟微任务，保证回调异步执行
        setTimeout(() => {
            if (this.#PromiseState === 'fulfilled') {
                // 依次执行所有已存储的onFulfilled回调，执行后清空队列
                let cb;
                while ((cb = this.#fulfilledCallbacks.shift())) {
                    cb(this.#PromiseResult);
                }
            } else if (this.#PromiseState === 'rejected') {
                // 依次执行所有已存储的onRejected回调，执行后清空队列
                let cb;
                while ((cb = this.#rejectedCallbacks.shift())) {
                    cb(this.#PromiseResult);
                }
            }
        }, 0);
    }

    // then方法：返回新Promise，实现链式调用
    then(onFulfilled, onRejected) {
        // 处理回调透传：非函数则使用默认回调
        const _onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : value => value;
        // onRejected非函数时抛出原因，让新Promise reject实现错误透传
        const _onRejected = typeof onRejected === 'function' ? onRejected : reason => { throw reason; };

        // 创建要返回的新Promise（链式调用核心）
        const newPromise = new MyPromise1((resolveNew, rejectNew) => {
            // 包装onFulfilled逻辑：处理返回值、异常和thenable
            const handleFulfilled = (value) => {
                try {
                    const result = _onFulfilled(value);
                    // 返回值为thenable时，新Promise跟随其状态
                    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
                        result.then(resolveNew, rejectNew);
                    } else {
                        resolveNew(result);
                    }
                } catch (e) {
                    rejectNew(e);
                }
            };

            // 包装onRejected逻辑：处理返回值、异常和thenable
            const handleRejected = (reason) => {
                try {
                    const result = _onRejected(reason);
                    // 错误被捕获后返回值为thenable时，新Promise跟随其状态；否则resolve
                    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
                        result.then(resolveNew, rejectNew);
                    } else {
                        resolveNew(result);
                    }
                } catch (e) {
                    rejectNew(e);
                }
            };

            // 根据当前Promise状态决定回调执行时机
            if (this.#PromiseState === 'fulfilled') {
                // 已完成状态：异步执行回调
                setTimeout(() => handleFulfilled(this.#PromiseResult), 0);
            } else if (this.#PromiseState === 'rejected') {
                // 已拒绝状态：异步执行回调
                setTimeout(() => handleRejected(this.#PromiseResult), 0);
            } else {
                // 待处理状态：将回调存入队列，等待状态转换后执行
                this.#fulfilledCallbacks.push(handleFulfilled);
                this.#rejectedCallbacks.push(handleRejected);
            }
        });

        // 返回新Promise，支持链式调用
        return newPromise;
    }
}

const mPromise = new MyPromise1((resolve, reject) => {
    // resolve('成功')
    reject('失败')
    // throw new Error('失败')
}).then(res => {
    console.log(res);
}).then(res => {
    console.log(res);
}).then(res => {
    console.log(res);
})

const p = new Promise((resolve, reject) => {
    resolve('成功')
})
console.log(mPromise,p);
