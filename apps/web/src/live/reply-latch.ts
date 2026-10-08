// Pure: an interrupt silences the rest of the agent's reply. Playback stops
// at once, but the Live session keeps sending the reply's audio until the
// turn ends; without the latch that audio would play again. Tested in
// `test/reply-latch.test.ts`.

export class ReplyLatch {
  private replying = false;
  private mutedValue = false;

  get muted(): boolean {
    return this.mutedValue;
  }

  /** One audio chunk of the reply arrived. True when it may play. */
  audio(): boolean {
    this.replying = true;
    return !this.mutedValue;
  }

  /** The user interrupted. Mutes the reply only while one is still arriving. */
  interrupt(): void {
    if (this.replying) this.mutedValue = true;
  }

  /** `generationComplete`, `turnComplete`, `interrupted` or a closed session: the reply is over. */
  end(): void {
    this.replying = false;
    this.mutedValue = false;
  }
}
