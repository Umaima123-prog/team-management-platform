export interface CounterDocument {
  // _id is the projectId this counter belongs to (one counter per
  // project), not an auto-generated ObjectId.
  _id: string;
  workspaceId: string;
  seq: number;
}
