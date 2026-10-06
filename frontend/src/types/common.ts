export interface ProgressMessage {
  type: string;
  task_id: number;
  progress: number;
  speed?: string;
  segment: number;
  total: number;
  status: string;
}

export interface Stats {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  downloading_tasks: number;
  total_size: number;
  total_size_str: string;
  avg_speed: number;
  avg_speed_str: string;
  current_speed: number;
  current_speed_str: string;
  speed_rating: number;
}
