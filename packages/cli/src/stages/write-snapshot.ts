import type { PageSnapshot } from "@pagepocket/lib";

type WriteSnapshotInput = {
  outputDir: string;
  snapshot: PageSnapshot;
};

export const writeSnapshotFiles = async (input: WriteSnapshotInput) => {
  await input.snapshot.toDirectory(input.outputDir);
  await input.snapshot.content.dispose?.();
};
