# RC FLIGHT SIMULATOR

Simulador 3D de aeromodelismo de radiocontrol para navegador (PC, tablet y móvil), con física
aerodinámica por superficies, 30 aeronaves, 6 escenarios, meteorología que afecta al vuelo,
entrenamiento, desafíos, estadísticas y repeticiones. Todo el contenido (modelos 3D, terrenos,
texturas y sonidos) se genera por código: no hay recursos externos ni referencias a archivos inexistentes.

## Jugar en línea

**https://jorgevalencia22.github.io/picsim/** (GitHub Pages, se actualiza con cada push a `main`).
En Android (Chrome) usa «Instalar aplicación»; en iPhone (Safari) usa Compartir → «Añadir a pantalla de
inicio»: se abre a pantalla completa, en horizontal y funciona sin conexión tras la primera visita.

También está listo para **Render**: en el panel de Render elige *New → Blueprint* y el repositorio;
`render.yaml` arranca `node server.js`, que sirve el juego y la API de la mejora de pago.
Para la **Play Store** puede empaquetarse la PWA como *Trusted Web Activity* (p. ej. con Bubblewrap).

## Mejora de pago «Render realista» (5 USD)

Mejora **solo visual** (Configuración → Gráficos): búfer HDR con MSAA, bloom, curva fílmica ACES,
gradación de color, perspectiva aérea, sombras de alta resolución y pintura con barniz. No cambia la
física ni la sensación de vuelo. Coste medido en un ThinkPad T480 (gráfica integrada, 1920×1080):
29,5 ms → 37,1 ms por fotograma.

- **Con servidor** (`node server.js`, p. ej. Render como servicio web): la compra usa Stripe Checkout
  (`STRIPE_SECRET_KEY`) y los códigos de descuento se canjean en el servidor, que los marca como usados
  para siempre en todos los dispositivos (registro en `LICENSE_DB`; necesita disco persistente).
- **Sin servidor** (GitHub Pages): no hay pasarela de pago y el código queda marcado como usado solo en
  ese navegador. Cualquier desbloqueo hecho en el cliente puede saltarse con las herramientas del
  navegador: la protección real depende del servidor.
- Los códigos nunca se guardan en claro: solo su SHA-256 (`PREMIUM_CODE_HASHES` en el servidor).

## Instalación y ejecución

Requisitos: un navegador moderno con WebGL2 (Chrome, Edge, Firefox o Safari recientes) y
Node.js ≥ 18 sólo para el servidor local y las pruebas.

```bash
npm install        # sólo instala three como dependencia de desarrollo (para las pruebas en Node)
npm start          # servidor estático en http://localhost:8080
npm test           # pruebas unitarias y de integración
```

Three.js r186 está incluido en `vendor/three/` y se carga con un *import map*, así que la carpeta
del proyecto (sin `node_modules`, `tests` ni `server.js`) puede publicarse tal cual en cualquier
alojamiento estático. No hay paso de compilación.

## Controles

| Acción | Teclado (por defecto) | Táctil |
|---|---|---|
| Profundidad (tirar / empujar) | S / W (o ↓ / ↑) | stick derecho (Mode 2) |
| Alerones | A / D (o ← / →) | stick derecho |
| Timón | Q / E | stick izquierdo |
| Acelerador | Shift / Ctrl (o X / Z) | stick izquierdo (sin muelle) |
| Flaps (0/50/100 %) | F | botón Flaps |
| Aerofrenos / mariposa | V (mantener) | botón |
| Frenos de rueda | B (mantener) | botón |
| Tren retráctil | L | botón Tren |
| Lanzar (mano / goma) | Espacio | botón Lanzar |
| Cambiar cámara | C | botón |
| Reiniciar | R | botón |
| Pausa / menú de vuelo | P, Esc, Tab | botón |
| HUD / instrumentos | G / I | botones |
| Zoom | + / − / rueda | pellizco |
| Seguimiento de la cámara de piloto | T | — |

Todas las teclas se reasignan en *Configuración → Controles* (dos teclas por acción). El ratón
mueve la cámara (arrastrar, rueda) y, opcionalmente, pilota con el puntero capturado. Joysticks,
gamepads y emisoras RC USB funcionan mediante la Gamepad API, con asignación de ejes, inversión,
zona muerta, calibración de extremos y centros y monitor de ejes en vivo; las emisoras EdgeTX/
OpenTX/FrSky/RadioMaster/Spektrum se detectan por nombre y se asignan en AETR/TAER. Los sticks
táctiles admiten Mode 1–4, tamaño, opacidad, retorno al centro y reposicionamiento.

**Vuelo realista por defecto: sin estabilizador ni giróscopo.** Si dejas el avión inclinado, se
comporta según su aerodinámica: jets, warbirds y acrobáticos mantienen el alabeo; los entrenadores
con mucho diedro tienden a nivelarse despacio, igual que los reales. Cada avión viene trimado de
fábrica contra el par motor y puedes trimar como en una emisora (J/K alerón, U/M profundidad, N/H
timón, O reinicia; botones ▲▼◀▶ en móvil) y alternar **dual rate** (Y / botón D/R). El giróscopo y
el estabilizador existen sólo como ayudas opcionales.

**Móvil (estilo PicaSim):** dos paneles cuadrados tipo cardán que responden en toda la mitad de la
pantalla, acelerador relativo que se queda donde lo dejas, trims junto a cada stick y modos 1–4.

## Qué está implementado

### Física (src/aircraft)
- Sólido rígido de 6 GDL: masa, CG, tensor de inercia, cuaterniones, ecuaciones de Euler con
  término giroscópico del rotor, integración semiimplícita a **paso fijo de 240 Hz** independiente
  de los FPS (verificado en pruebas).
- Modelo aerodinámico **por paneles**: cada semiala (4 paneles), estabilizadores, derivas, cola en V,
  biplanos y placas del fuselaje calculan su flujo local (traslación + rotación + viento local +
  estela de la hélice con remolino). `L = ½ρV²S·CL`, `D = ½ρV²S·CD` con resistencia inducida,
  efecto suelo, curva 360° con pérdida progresiva, momento propio del perfil, downwash sobre la cola.
- Superficies de control con signo calculado geométricamente (alerones, profundidad, timón,
  ruddervators, estabilizador integral, flaps, spoilers, mariposa) y servos con velocidad limitada.
- Comportamientos **emergentes** (no animados): estabilidad estática, efecto diedro, caída de ala
  en pérdida, snap rolls en pérdida acelerada, barrenas, knife-edge, harrier, torque roll, veleta.
- El CG de cada avión se obtiene del **punto neutro calculado numéricamente** y un margen estático;
  la incidencia de cola se trima automáticamente. Las fichas técnicas (pérdida, crucero, máxima,
  L/D, autonomía) se calculan con el mismo modelo.
- Propulsión: eléctrico (RPM, curva de empuje, batería en Wh con caída de tensión y corte, temperatura),
  glow 2T/4T y gasolina (ralentí, fluctuaciones, consumo, parada sin combustible o por golpe de hélice),
  turbina (retardo asimétrico, limitador, EGT, consumo) y EDF. Par motor, factor P/remolino y giroscópico.
- Contacto con el suelo por resorte-amortiguador con fricción de rodadura/lateral, dirección de rueda
  de morro o cola, frenos y superficies (césped, asfalto, tierra, arena, terreno irregular…).
- Daños por impacto en alas, cola, fuselaje, tren y hélice con consecuencias funcionales (pérdida de
  sustentación y mando, ala desprendida, tren colapsado, empuje reducido), destrucción y escombros.
  Colisiones con árboles (tronco sólido, copa blanda), edificios, vallas, coches, postes y agua.

### Aeronaves (30)
Entrenadores (Skylark, Cessna 182, J-3 Cub, Falcon LW-46, Volt Ranger, Titan 2100), acrobáticos
(Extra 300, Edge 540, Su-26, Yak-55, CAP 232, Vortex 3D), planeadores (Aquila RES, Zephyr E,
Nimbus F3J, Ridge Racer V, Apex F3B, Ventus 4.5), jets (Viper SJ, L-39, F-16, F-18, Jetster 70 EDF,
Strike 90 EDF) y clásicos (P-51, Spitfire, Pitts, Tundra Cub, Outback Bush, Formula Pylon Racer).
Modelos 3D procedurales generados desde la misma geometría que vuela, con superficies de control
articuladas, hélice con disco difuminado, tren con dirección, giro y retracción, cabina y detalles.

### Escenarios (6)
Aeródromo RC, campo abierto, cordillera (ladera), costa con acantilados, aeródromo de competición y
pueblo rural. Terreno por bloques con 3 niveles de detalle y faldones, con textura de pasto mezclada a
tres escalas (sin repetición visible). Árboles realistas de bajo peso: copas de «tarjetas» de follaje
con hojas, agujas y corteza dibujadas por código (sin descargas), normales esféricas y oclusión en el
interior; pinos, cipreses y álamos con siluetas rama a rama; ~30–60 triángulos por árbol cercano y
~10 por árbol lejano, con balanceo y aleteo por viento. Objetos fusionados por bloques (culling), agua
animada, mangas de viento y banderas orientadas por el viento.

Cámara: seguimiento con resortes críticamente amortiguados que se adelantan a la trayectoria.
Prueba automática con turbulencia y fotogramas irregulares: la mirada es 10× más estable que la
versión anterior en la cámara de seguimiento (0,765° → 0,076° de sacudida por fotograma) y 2× en la de
piloto, con el avión a menos de 3° del centro.

Vida del escenario (Configuración → Gráficos → Vida en el escenario):
- **Otros aviones en el aire** (0–3): compañeros del club que vuelan circuitos con la misma física
  que el jugador, gobernados por el piloto automático (solo en vuelo libre). Una prueba automática
  vuela las 12 aeronaves del grupo durante 2 minutos sin caídas. No emiten sonido ni colisionan con
  el avión del jugador.
- **Animales, vehículos y aves**: rebaños de vacas y ovejas que pastan y huyen si el avión pasa bajo,
  autos que circulan por los caminos y bandadas que planean en círculo y se dispersan al acercarse.
- **Humo acrobático** (tecla `1` o botón «Humo»): estela continua desde la cola que deriva con el viento.

### Meteorología
Viento con gradiente vertical, ráfagas, turbulencia 3D advectada, ascendencia de ladera calculada con
el gradiente del terreno, rotores de sotavento, térmicas con ciclo de vida (sólo de día), densidad por
altitud y temperatura, cielo procedural por hora del día (amanecer, atardecer, noche con luna y
estrellas), nubes, niebla y lluvia limitadas a una visibilidad jugable.

### Juego e interfaz
- Menú principal sobre un vuelo de demostración real (piloto automático), preparación de vuelo con
  vista previa 3D, hangar con ficha técnica, **personalización** (colores, diseños, acabados,
  matrícula, varias decoraciones por avión) y **editor de aeronaves** (masa, CG, superficie alar,
  perfil, potencia, recorridos, flaps, resistencia, inercia, servos) con advertencias de estabilidad.
- Cámaras: piloto (auto-zoom), seguimiento, cinematográfica (7 planos), a bordo con vibración y libre.
- HUD configurable, instrumentos (horizonte, anemómetro, altímetro, variómetro, brújula, tacómetro,
  batería/combustible según el tipo), enlace de radio simulado con failsafe, vario sonoro.
- Asistencias: principiante (auto-nivelado, coordinación, protección de pérdida, ayuda al flare,
  dirección en tierra), intermedio (giróscopo) y experto. Niveles de simulación arcade/casual/
  realista/experto que cambian turbulencia, par, giroscópico, amortiguación y tolerancia a daños.
- 8 lecciones con objetivos verificables e instructor visual (muestra el stick a mover según el modo).
- 10 desafíos con puntuación, medallas, récord y límite de tiempo.
- Detección de maniobras por comportamiento real: looping, looping invertido, medio looping, tonel,
  doble tonel, medio tonel, snap roll, Immelmann, Split-S, ocho cubano, invertido, knife-edge,
  harrier, torque roll y hover. Evaluación de aterrizajes (contacto, velocidad, alineación, punto,
  estabilidad, rebotes, daños).
- Estadísticas persistentes con gráficos e historial; repeticiones grabadas (30 Hz, IndexedDB) con
  reproducción, búsqueda, velocidad 0,25–4× y cambio de cámara.
- Audio sintetizado con Web Audio: voces de motor por tipo siguiendo RPM y carga, flujo de aire,
  rodadura, impactos, ambiente por escenario, HRTF + Doppler, buses independientes.
- Perfiles gráficos muy bajo → ultra, resolución dinámica, límite de FPS, indicador de rendimiento.
- Español e inglés, unidades métricas/imperiales, escala de interfaz, alto contraste, reducir movimiento.

## Estructura

```
index.html            server.js            vendor/three/        styles/*.css
src/main.js           — aplicación, navegación y bucle
src/core/             — Simulation, WeatherSystem, CollisionSystem, AudioEngine, Storage, i18n, EventBus
src/aircraft/         — Aerodynamics, AeroModel (paneles), AircraftPhysics, Propulsion, AircraftRegistry, Autopilot
src/controls/         — Keyboard/Gamepad/Touch, RadioController (emisoras), InputManager, FlightAssist
src/camera/           — CameraManager
src/environments/     — EnvironmentBase + 6 escenarios (datos puros, sin Three.js)
src/render/           — Renderer, SkySystem, EnvironmentRenderer, AircraftModel, Effects, texturas
src/gameplay/         — ManeuverDetector, LandingEvaluator, Missions, Statistics, Replay
src/ui/               — pantallas, HUD, instrumentos, pausa, repeticiones
src/net/              — contrato para un futuro multijugador (no implementado)
tests/                — pruebas con node:test
```

La física, los escenarios, la meteorología y la lógica de juego no dependen de Three.js ni del DOM,
por eso se prueban directamente en Node.

## Pruebas (resultado real de `npm test`)

33 pruebas, 33 correctas (≈ 5 s). Incluyen: matemática de cuaterniones; curvas CL/CD con pérdida y
flaps; atmósfera; propulsión eléctrica y turbina (retardo y parada por combustible); **las 30 aeronaves
estables en vuelo nivelado y en viraje con piloto automático durante 60 s**; despegue en < 40 m;
rodadura y frenado; pérdida y recuperación; viento de cara y deriva; independencia de los FPS;
aterrizaje suave sin daños, aterrizaje duro con daño de tren, destrucción y modo sin daños; ala
perdida; colisión con edificio; agua; asistencia que nivela; **tonel y looping completos sin topes en
Principiante (entrenador, acrobático y jet)**; topes opcionales; planeo medido frente a ficha técnica;
generación de los 6 escenarios (pistas planas, colisionadores); coincidencia exacta altura física/malla;
superficies; ascendencia de ladera, térmicas y densidad; detección de looping y tonel a partir de
vuelo simulado; puntuación de aterrizajes; repetición e interpolación; persistencia de estadísticas y
récords; avance de lecciones; curvas, calibración, modos de emisora y detección de emisoras; fusión
de configuración.

Además se verificó en el navegador: arranque, menú principal con demostración, hangar y vistas 3D,
preparación de vuelo, despegue y vuelo con teclado, tonel y looping libres en Principiante, pausa,
configuración, accidente con escombros y diálogo, reinicio, repetición, lección 1 con instructor,
carga de los 6 escenarios y los 30 modelos sin errores de consola (124–154 llamadas de dibujo y
60–117 mil triángulos por escena) y disposición móvil horizontal (844×390) con sticks táctiles.

## Limitaciones reales

- **Multijugador**: no implementado (no hay servidor). `src/net/NetworkAdapter.js` documenta el
  contrato previsto y la simulación ya serializa estados compactos (los mismos que usan las repeticiones).
- **Hardware**: joysticks, emisoras USB y pantallas táctiles se probaron con eventos simulados y
  emulación de viewport, no con dispositivos físicos en esta sesión. Las emisoras pueden necesitar
  invertir algún eje en la pantalla de calibración.
- **Helicópteros y multirrotores**: no incluidos; el registro de aeronaves admite nuevas categorías.
- **Web Workers**: no se usan; la física completa cuesta ~0,1–0,3 ms por fotograma y la generación de
  un escenario < 150 ms, así que no fue necesario.
- Los coeficientes aerodinámicos son aproximaciones de ingeniería (no datos de túnel de viento); las
  fichas técnicas indican que son valores estimados con el modelo. No se modela la rotura por exceso de g.
- Escenarios de 3–4 km de lado generados por completo al cargarse (sin carga por streaming); el área
  de vuelo se limita con el alcance de radio configurable.
- La memoria mostrada en el indicador de rendimiento sólo está disponible en navegadores Chromium.
- Las tipografías se cargan de Google Fonts; sin conexión se usan las del sistema.
