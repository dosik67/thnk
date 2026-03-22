export type Category = 'Task' | 'Idea';

export interface Project {
  id: string;
  uid: string;
  name: string;
  createdAt: number;
}

export interface BaseItem {
  id: string;
  uid: string;
  projectId: string;
  rawMessage: string;
  title: string;
  description: string;
  category: Category;
  createdAt: number;
  attachment?: { name: string; url: string };
}

export interface TaskItem extends BaseItem {
  category: 'Task';
  isDone: boolean;
}

export interface IdeaItem extends BaseItem {
  category: 'Idea';
  priority: number; // 1-5 (assigned by AI initially, can be changed)
  rating: number; // 1-5 (user rated)
}

export type Item = TaskItem | IdeaItem;
