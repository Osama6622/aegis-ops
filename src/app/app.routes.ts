import { Routes } from '@angular/router';
import { IncidentConsolePageComponent } from './features/incident-console/incident-console-page.component';

export const routes: Routes = [
  {
    path: '',
    component: IncidentConsolePageComponent,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
