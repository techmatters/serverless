import type { EventType } from './eventTypes';

export type EventFields = {
  // Default fields
  EventType: EventType;
  AccountSid: string;
  WorkspaceSid: string;
  WorkspaceName: string;
  EventDescription: string;
  ResourceType: 'Task' | 'Reservation' | 'Worker' | 'Activity' | 'Workflow' | 'Workspace';
  ResourceSid: string;
  Timestamp: string;

  // Task
  TaskSid: string;
  TaskAttributes: string;
  TaskAge: number;
  TaskPriority: number;
  TaskAssignmentStatus: string;
  TaskCanceledReason: string;
  TaskCompletedReason: string;

  // TaskChannel
  TaskChannelSid: string;
  TaskChannelName: string;
  TaskChannelUniqueName: string;
  TaskChannelOptimizedRouting: boolean;

  // Worker
  WorkerSid: string;
  WorkerName: string;
  WorkerAttributes: string;
  WorkerActivitySid: string;
  WorkerActivityName: string;
  WorkerVersion: string;
  WorkerTimeInPreviousActivity: number;
  WorkerTimeInPreviousActivityMs: number;
  WorkerPreviousActivitySid: string;
  WorkerChannelAvailable: boolean;
  WorkerChannelAvailableCapacity: number;
  WorkerChannelPreviousCapacity: number;
  WorkerChannelTaskCount: number;
};
