import { UIMessageChunk } from "ai";

function asyncIteratorToStream<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal
): ReadableStream<T> {
  // Set up abort listener ONCE when stream is created
  if (signal) {
    signal.addEventListener("abort", async () => {
      await iterator.return?.();
    });
  }

  return new ReadableStream<T>({
    async pull(controller) {
      // Check if aborted
      if (signal?.aborted) {
        await iterator.return?.();
        controller.close();
        return;
      }

      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        console.error("Stream error:", err);
        controller.error(err);
      }
    },
    async cancel(reason) {
      await iterator.return?.();
    },
  });
}

export function createTRPCChatTransport<
  TInput extends Record<string, any>,
  TOutput extends AsyncIterable<UIMessageChunk>,
>(trpcProcedure: (input: TInput) => Promise<TOutput>) {
  return {
    async sendMessages(
      options: TInput & { abortSignal?: AbortSignal }
    ): Promise<ReadableStream<UIMessageChunk>> {
      const { abortSignal, ...input } = options;

      // Early exit if already aborted
      if (abortSignal?.aborted) {
        return new ReadableStream({
          start(controller) {
            controller.close();
          },
        });
      }

      const result = await trpcProcedure(input as TInput);
      const iterator = result[Symbol.asyncIterator]();

      // Simple and clean - just return the stream
      return asyncIteratorToStream<UIMessageChunk>(iterator, abortSignal);
    },
    async reconnectToStream() {},
  };
}
