import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { DirectionService } from './core/services/direction.service';

describe('App & Console Shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('creates the root standalone App component', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('toggles document dir attribute cleanly between ltr and rtl via DirectionService', () => {
    const directionService = TestBed.inject(DirectionService);
    TestBed.flushEffects();
    expect(directionService.dir()).toBe('ltr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    directionService.toggleDirection();
    TestBed.flushEffects();
    expect(directionService.dir()).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});
