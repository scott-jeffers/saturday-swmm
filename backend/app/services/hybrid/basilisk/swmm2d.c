/**
# swmm2d — Basilisk Saint-Venant surface for Saturday-SWMM hybrid runs

Generic (model-independent) driver. Everything model-specific is read at
runtime from the working directory, so this file is compiled once per machine:

    qcc -O2 -Wall -o swmm2d swmm2d.c -lm            # Linux / WSL
    qcc -source swmm2d.c  -> _swmm2d.c (portable C)  # cross-compile for Windows

Inputs (written by the Python backend, SI units, local coordinates):

* `config.txt`   `key value` lines: L x0 y0 min_level max_level manning dry
                 htol qtol dtmax cfl dem_level
* `dem.bin`      float32 bed elevation [m], (2^dem_level)^2 row-major,
                 row 0 = south, covering the square [x0,x0+L]x[y0,y0+L].
                 Values >= 1e19 are "no data" and become walls.
* `outside.bin`  optional uint8 (2^dem_level)^2 mask, 1 = outside the model
                 area: water reaching those cells leaves the domain (counted).
* `sources.txt`  first line n, then n lines `x y` (local m)

Stepping protocol (stdin -> stdout, one command per line, replies start "R"):

    S <t_target>\n<q_0 ... q_{n-1}>\n
        Advance to t_target with source rates q_i [m3/s] (+ into 2D,
        - drainage out of 2D, limited by water available).
        Reply: "R S <t> <cells> <steps>\n" then four lines of n numbers:
        depth h [m], bed zb [m], cell area [m2], achieved volume [m3]
        (signed, over the interval).
    D <nx> <ny> <path>\n
        Write a float32 depth raster (nx*ny, row 0 = south) to <path>.
        Reply: "R D <wet_cells> <volume_m3> <boundary_loss_m3>\n"
    Q\n  quit. Reply "R Q\n"
*/

#include "saint-venant.h"
#include "elevation.h"

/* ---------- runtime configuration ---------- */
static double cfg_L = 1000., cfg_x0 = 0., cfg_y0 = 0.;
static int cfg_minlevel = 5, cfg_maxlevel = 10, cfg_demlevel = 10;
static double cfg_manning = 0.03, cfg_htol = 0.02, cfg_qtol = 0.01;
static double cfg_dtmax = 5., cfg_dry = 1e-3, cfg_cfl = 0.4;

/* DEM pyramid: dem[l] has (1<<l)^2 cells, l = 0..cfg_demlevel */
static float ** dem = NULL;
#define NODATA 1e19
#define WALL_HEIGHT 1000.

/* outflow mask pyramid: fraction of each cell outside the model area */
static float ** outside = NULL;
static double boundary_loss = 0.;

static int n_src = 0;
static double * src_x = NULL, * src_y = NULL, * src_q = NULL, * src_vol = NULL;
static double t_target = 0., t_src = 0.;
static long steps_in_interval = 0;
static int quitting = 0;

static void die (const char * msg) {
  fprintf (stderr, "swmm2d: %s\n", msg);
  fflush (stderr);
  exit (1);
}

static void read_config (void)
{
  FILE * fp = fopen ("config.txt", "r");
  if (!fp) die ("cannot open config.txt");
  char key[64]; double v;
  while (fscanf (fp, "%63s %lf", key, &v) == 2) {
    if (!strcmp (key, "L")) cfg_L = v;
    else if (!strcmp (key, "x0")) cfg_x0 = v;
    else if (!strcmp (key, "y0")) cfg_y0 = v;
    else if (!strcmp (key, "min_level")) cfg_minlevel = (int) v;
    else if (!strcmp (key, "max_level")) cfg_maxlevel = (int) v;
    else if (!strcmp (key, "dem_level")) cfg_demlevel = (int) v;
    else if (!strcmp (key, "manning")) cfg_manning = v;
    else if (!strcmp (key, "dry")) cfg_dry = v;
    else if (!strcmp (key, "htol")) cfg_htol = v;
    else if (!strcmp (key, "qtol")) cfg_qtol = v;
    else if (!strcmp (key, "dtmax")) cfg_dtmax = v;
    else if (!strcmp (key, "cfl")) cfg_cfl = v;
  }
  fclose (fp);
  if (cfg_demlevel < cfg_maxlevel) cfg_maxlevel = cfg_demlevel;
  if (cfg_minlevel > cfg_maxlevel) cfg_minlevel = cfg_maxlevel;
}

static void read_dem (void)
{
  int L = cfg_demlevel;
  dem = (float **) calloc (L + 1, sizeof (float *));
  long n = 1L << L;
  dem[L] = (float *) malloc (n*n*sizeof (float));
  FILE * fp = fopen ("dem.bin", "rb");
  if (!fp) die ("cannot open dem.bin");
  if (fread (dem[L], sizeof (float), n*n, fp) != (size_t) (n*n))
    die ("dem.bin is truncated");
  fclose (fp);
  /* wall height = max valid + WALL_HEIGHT */
  double zmax = -1e30;
  for (long k = 0; k < n*n; k++)
    if (dem[L][k] < NODATA && dem[L][k] > zmax) zmax = dem[L][k];
  for (long k = 0; k < n*n; k++)
    if (!(dem[L][k] < NODATA)) dem[L][k] = zmax + WALL_HEIGHT;
  /* averaged pyramid so a level-l cell gets the mean bed of its footprint */
  for (int l = L - 1; l >= 0; l--) {
    long m = 1L << l;
    dem[l] = (float *) malloc (m*m*sizeof (float));
    for (long j = 0; j < m; j++)
      for (long i = 0; i < m; i++) {
        long nf = 2*m;
        float * f = dem[l + 1];
        dem[l][j*m + i] = 0.25f*(f[(2*j)*nf + 2*i] + f[(2*j)*nf + 2*i + 1] +
                                 f[(2*j + 1)*nf + 2*i] + f[(2*j + 1)*nf + 2*i + 1]);
      }
  }
}

static void read_outside (void)
{
  int L = cfg_demlevel;
  long n = 1L << L;
  FILE * fp = fopen ("outside.bin", "rb");
  if (!fp) return;
  unsigned char * m = (unsigned char *) malloc (n*n);
  if (fread (m, 1, n*n, fp) != (size_t) (n*n)) die ("outside.bin is truncated");
  fclose (fp);
  outside = (float **) calloc (L + 1, sizeof (float *));
  outside[L] = (float *) malloc (n*n*sizeof (float));
  for (long k = 0; k < n*n; k++) outside[L][k] = m[k] ? 1.f : 0.f;
  free (m);
  for (int l = L - 1; l >= 0; l--) {
    long mm = 1L << l, nf = 2*mm;
    float * f = outside[l + 1];
    outside[l] = (float *) malloc (mm*mm*sizeof (float));
    for (long j = 0; j < mm; j++)
      for (long i = 0; i < mm; i++)
        outside[l][j*mm + i] = 0.25f*(f[(2*j)*nf + 2*i] + f[(2*j)*nf + 2*i + 1] +
                                      f[(2*j + 1)*nf + 2*i] + f[(2*j + 1)*nf + 2*i + 1]);
  }
}

static int is_outside (int level, double x, double y)
{
  if (!outside) return 0;
  int l = level > cfg_demlevel ? cfg_demlevel : level;
  long m = 1L << l;
  long i = (long) floor ((x - X0)/L0*m), j = (long) floor ((y - Y0)/L0*m);
  if (i < 0) i = 0; if (i >= m) i = m - 1;
  if (j < 0) j = 0; if (j >= m) j = m - 1;
  return outside[l][j*m + i] > 0.5f;
}

static double dem_at (int level, double x, double y)
{
  int l = level > cfg_demlevel ? cfg_demlevel : level;
  long m = 1L << l;
  long i = (long) floor ((x - X0)/L0*m), j = (long) floor ((y - Y0)/L0*m);
  if (i < 0) i = 0; if (i >= m) i = m - 1;
  if (j < 0) j = 0; if (j >= m) j = m - 1;
  return dem[l][j*m + i];
}

static void read_sources (void)
{
  FILE * fp = fopen ("sources.txt", "r");
  if (!fp) die ("cannot open sources.txt");
  if (fscanf (fp, "%d", &n_src) != 1) die ("bad sources.txt");
  int nn = n_src > 0 ? n_src : 1;
  src_x = (double *) calloc (nn, sizeof (double));
  src_y = (double *) calloc (nn, sizeof (double));
  src_q = (double *) calloc (nn, sizeof (double));
  src_vol = (double *) calloc (nn, sizeof (double));
  for (int k = 0; k < n_src; k++)
    if (fscanf (fp, "%lf %lf", &src_x[k], &src_y[k]) != 2) die ("bad source line");
  fclose (fp);
}

/* bed refinement straight from the DEM pyramid (exact at every level) */
static void refine_zb (Point point, scalar zb)
{
  foreach_child()
    zb[] = dem_at (level, x, y);
}

int main()
{
  read_config();
  read_dem();
  read_outside();
  read_sources();
  size (cfg_L);
  origin (cfg_x0, cfg_y0);
  N = 1 << cfg_minlevel;
  G = 9.81;
  dry = cfg_dry*0.01;     /* numerical dry threshold, well below physical one */
  CFL = cfg_cfl;
  DT = cfg_dtmax;
  setvbuf (stdout, NULL, _IOFBF, 1 << 16);
  run();
  return 0;
}

event init (i = 0)
{
  // conserve_elevation(); (not mass-conservative on slopes)
  zb.refine = refine_zb;
  /* start at max resolution near coupling points, coarse elsewhere */
  foreach()
    zb[] = dem_at (level, x, y);
  for (int pass = cfg_minlevel; pass < cfg_maxlevel; pass++) {
    scalar tag[];
    foreach() tag[] = 0.;
    for (int k = 0; k < n_src; k++) {
      Point point = locate (src_x[k], src_y[k]);
      if (point.level >= 0 && point.level < cfg_maxlevel) tag[] = 1.;
    }
    astats s = adapt_wavelet ({tag}, (double[]){0.5}, cfg_maxlevel, cfg_minlevel);
    if (s.nf == 0) break;
  }
  foreach() {
    zb[] = dem_at (level, x, y);
    h[] = 0.;
    u.x[] = u.y[] = 0.;
  }
}

/* apply source rates over [t_src, t] and accumulate achieved volumes */
static void apply_sources (void)
{
  double dtl = t - t_src;
  if (dtl <= 0.) return;
  for (int k = 0; k < n_src; k++) {
    double q = src_q[k];
    if (q == 0.) continue;
    Point point = locate (src_x[k], src_y[k]);
    if (point.level < 0) continue;
    double a = sq (L0/(1 << point.level));
    double dv = q*dtl;
    if (dv < 0.) {
      double avail = h[]*a;
      if (-dv > avail) dv = -avail;
    }
    h[] += dv/a;
    if (h[] < 0.) h[] = 0.;
    src_vol[k] += dv;
  }
  t_src = t;
}

static void reply_step (void)
{
  long cells = 0;
  foreach (reduction(+:cells)) cells++;
  printf ("R S %.6f %ld %ld\n", t, cells, steps_in_interval);
  double * hv = (double *) malloc (sizeof (double)*(n_src + 1));
  double * zv = (double *) malloc (sizeof (double)*(n_src + 1));
  double * av = (double *) malloc (sizeof (double)*(n_src + 1));
  for (int k = 0; k < n_src; k++) {
    Point point = locate (src_x[k], src_y[k]);
    if (point.level >= 0) {
      hv[k] = h[]; zv[k] = zb[]; av[k] = sq (L0/(1 << point.level));
    }
    else
      hv[k] = 0., zv[k] = 0., av[k] = 1.;
  }
  for (int k = 0; k < n_src; k++) printf (k ? " %.6g" : "%.6g", hv[k]);
  printf ("\n");
  for (int k = 0; k < n_src; k++) printf (k ? " %.6f" : "%.6f", zv[k]);
  printf ("\n");
  for (int k = 0; k < n_src; k++) printf (k ? " %.6g" : "%.6g", av[k]);
  printf ("\n");
  for (int k = 0; k < n_src; k++) printf (k ? " %.6g" : "%.6g", src_vol[k]);
  printf ("\n");
  fflush (stdout);
  free (hv); free (zv); free (av);
}

static void dump_raster (int nx, int ny, const char * path)
{
  float * buf = (float *) calloc ((size_t) nx*ny, sizeof (float));
  double vol = 0.; long wet = 0;
  double px = L0/nx, py = L0/ny;
  foreach (serial) {
    vol += h[]*sq (Delta);
    if (h[] > cfg_dry) {
      wet++;
      int i0 = (int) floor ((x - Delta/2. - X0)/px + 0.5);
      int i1 = (int) floor ((x + Delta/2. - X0)/px + 0.5);
      int j0 = (int) floor ((y - Delta/2. - Y0)/py + 0.5);
      int j1 = (int) floor ((y + Delta/2. - Y0)/py + 0.5);
      if (i1 <= i0) i1 = i0 + 1;
      if (j1 <= j0) j1 = j0 + 1;
      for (int j = j0; j < j1; j++)
        for (int i = i0; i < i1; i++)
          if (i >= 0 && i < nx && j >= 0 && j < ny)
            buf[(size_t) j*nx + i] = h[];
    }
  }
  FILE * fp = fopen (path, "wb");
  if (fp) {
    fwrite (buf, sizeof (float), (size_t) nx*ny, fp);
    fclose (fp);
  }
  free (buf);
  printf ("R D %ld %.9g %.9g\n", wet, vol, boundary_loss);
  fflush (stdout);
}

/* read commands until the next S (or Q) */
static void read_commands (void)
{
  char cmd[8];
  for (;;) {
    if (scanf ("%7s", cmd) != 1) { quitting = 1; return; }
    if (cmd[0] == 'Q') {
      printf ("R Q\n"); fflush (stdout);
      quitting = 1;
      return;
    }
    else if (cmd[0] == 'D') {
      int nx, ny; char path[4096];
      if (scanf ("%d %d %4095s", &nx, &ny, path) != 3) die ("bad D command");
      dump_raster (nx, ny, path);
    }
    else if (cmd[0] == 'S') {
      double tt;
      if (scanf ("%lf", &tt) != 1) die ("bad S command");
      for (int k = 0; k < n_src; k++)
        if (scanf ("%lf", &src_q[k]) != 1) die ("bad S rates");
      for (int k = 0; k < n_src; k++) src_vol[k] = 0.;
      t_target = tt;
      steps_in_interval = 0;
      return;
    }
    else
      die ("unknown command");
  }
}

/* coupling: runs at the start of every iteration */
event coupling (i++)
{
  apply_sources();
  if (t >= t_target - 1e-9) {
    if (i > 0 || t_target > 0.)
      reply_step();
    read_commands();
    if (quitting)
      return 1; /* stop the run */
  }
  double left = t_target - t;
  DT = left < cfg_dtmax ? left : cfg_dtmax;
  if (DT < 1e-6) DT = 1e-6;
  steps_in_interval++;
}

/* semi-implicit Manning friction; outflow through the outside mask */
event friction (i++)
{
  double n2 = sq (cfg_manning);
  double lost = 0.;
  foreach (reduction(+:lost)) {
    if (outside && h[] > 0. && is_outside (level, x, y)) {
      lost += h[]*sq (Delta);
      h[] = 0.;
      foreach_dimension()
        u.x[] = 0.;
    }
    else if (h[] > cfg_dry) {
      double s = norm (u);
      double cf = G*n2*s/pow (h[], 4./3.);
      double f = 1./(1. + dt*cf);
      foreach_dimension()
        u.x[] *= f;
    }
    else
      foreach_dimension()
        u.x[] = 0.;
  }
  boundary_loss += lost;
}

/* Refine where water is and where it carries flow: depth and unit discharge
   (h u). Never on bare terrain (eta) and never on raw velocity, which would
   refine every fast-moving millimetre film of sheet flow. */
event adapt (i++)
{
  vector q[];
  scalar active[];
  foreach() {
    foreach_dimension()
      q.x[] = h[]*u.x[];
    active[] = 0.;
  }
  /* sources carrying flow always sit in a finest cell: otherwise a point
     inflow into a dry coarse cell spreads over its whole footprint */
  for (int k = 0; k < n_src; k++)
    if (src_q[k] != 0.) {
      Point point = locate (src_x[k], src_y[k]);
      if (point.level >= 0) active[] = 1.;
    }
  adapt_wavelet ({h, q.x, q.y, active},
                 (double[]){cfg_htol, cfg_qtol, cfg_qtol, 0.5},
                 cfg_maxlevel, cfg_minlevel);
}

/* keep the main loop alive: the run ends only on a Q command */
event end (i = 2000000000) {}
