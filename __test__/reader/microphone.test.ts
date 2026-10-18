import { describe, expect, it, vi } from "vitest";
import { acquireMicrophone, stopMicrophone } from "../../src/reader/microphone";

describe("microphone lifecycle", () => {
  it("does not request a microphone after capture is cancelled", async () => {
    const getStream = vi.fn();
    await expect(acquireMicrophone(getStream, () => false)).resolves.toBeNull();
    expect(getStream).not.toHaveBeenCalled();
  });

  it("stops a stream that arrives after capture is cancelled", async () => {
    let deliverStream: (stream: MediaStream) => void = () => {};
    const getStream = vi.fn(() => new Promise<MediaStream>((resolve) => (deliverStream = resolve)));
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    let current = true;

    const pending = acquireMicrophone(getStream, () => current);
    current = false;
    deliverStream(stream);

    await expect(pending).resolves.toBeNull();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("stops every track when recording ends", () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopMicrophone({ getTracks: () => tracks } as unknown as MediaStream);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });
});
