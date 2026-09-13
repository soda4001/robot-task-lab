import { benchmark } from './simulation';
import { projectSchema } from './model';

self.onmessage = (event: MessageEvent) => {
  try {
    const project = projectSchema.parse(event.data);
    self.postMessage({ results: benchmark(project) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Test run failed.' });
  }
};
