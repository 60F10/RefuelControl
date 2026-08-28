# RefuelControl

PWA para registrar los repostajes de un coche **bífuel GLP + gasolina** (Dacia Sandero Stepway ECO-G 120).

Haces una foto del ticket, la IA extrae los datos, tú los revisas y se guardan en Google Sheets. El dashboard vive dentro de la propia app.

**Demo:** https://repostajesgofio.netlify.app/

---

## Qué resuelve

En un coche bífuel el consumo no se puede repartir: si llenas 40 L de GLP y 30 L de gasolina en el mismo ticket, no sabes cuántos kilómetros hiciste con cada uno. La mayoría de apps de repostajes lo estiman y el número sale mal.

Aquí introduces los dos parciales que da el ordenador de a bordo, y el cálculo se hace contra los kilómetros reales de cada combustible, acumulados desde la última vez que llenaste **ese** depósito.

---

## Funciona así

```
[Móvil] KM + parciales + foto del ticket
   │  la foto se reduce a 1400 px en el propio móvil (los HEIC del iPhone pasan a JPEG)
   ▼
[Netlify Function]  añade la URL del backend y el token, que nunca llegan al navegador
   ▼
[Apps Script]  guarda la foto en Drive → Gemini 2.5 Flash lee el ticket
   ▼
[Móvil] revisas estación, litros y precios, y corriges lo que haga falta
   ▼
[Apps Script]  escribe una fila por combustible y recalcula toda la hoja
   ▼
[Móvil] el dashboard se repinta con Chart.js
```

---

## Stack

| Capa | Tecnología |
|---|---|
| Front | HTML + CSS + JS sin framework, Chart.js por CDN, PWA con service worker |
| Hosting | Netlify |
| Proxy | Netlify Function (Node) — guarda las claves |
| Backend | Google Apps Script desplegado como aplicación web |
| IA | Gemini 2.5 Flash (visión) |
| Datos | Google Sheets |
| Ficheros | Google Drive |

Sin base de datos propia, sin servidor que mantener y con coste cero dentro de las capas gratuitas.

---

## Montarlo desde cero

### 1. Google Sheets y Apps Script

1. Crea una hoja de cálculo. En la primera pestaña, pon `ID` en la celda **A1**: el script localiza la hoja por ese valor.
2. **Extensiones → Apps Script** y pega el contenido de `Script.Repostaje.gs`.
3. **Configuración del proyecto → Propiedades del script**, y añade:

   | Propiedad | Valor |
   |---|---|
   | `GEMINI_API_KEY` | tu clave de [Google AI Studio](https://aistudio.google.com/apikey) |
   | `SHARED_TOKEN` | una cadena larga y aleatoria que inventes |
   | `CARPETA_RECIBOS_ID` | el ID de la carpeta de Drive donde guardar los tickets |

4. Marca **Mostrar el archivo de manifiesto `appsscript.json`** y añade los permisos:

   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/drive",
     "https://www.googleapis.com/auth/spreadsheets",
     "https://www.googleapis.com/auth/script.external_request",
     "https://www.googleapis.com/auth/script.container.ui"
   ]
   ```

   Sin `auth/drive` el script guarda los datos pero no las fotos, y falla en silencio.

5. Recarga la hoja y usa el menú **⛽ RefuelControl → Probar acceso a Drive**. Acepta los permisos. Debe responder `ok: true`.
6. **Implementar → Nueva implementación → Aplicación web**, con `Ejecutar como: Yo` y `Acceso: Cualquiera`. Copia la URL `/exec`.

### 2. Netlify

1. Conecta este repositorio a un sitio de Netlify. No hace falta comando de build.
2. **Site configuration → Environment variables**:

   | Variable | Valor |
   |---|---|
   | `GOOGLE_SCRIPT_URL` | la URL `/exec` del paso anterior |
   | `SHARED_TOKEN` | el mismo valor que pusiste en Apps Script |

3. Despliega.

El `netlify.toml` ya redirige `/api/repostaje` a la función. El front no contiene ninguna clave, así que el repositorio puede ser público.

### 3. Instalar en el móvil

- **Android:** Chrome → menú → *Añadir a pantalla de inicio*.
- **iPhone:** Safari → compartir → *Añadir a pantalla de inicio*. Tiene que ser Safari.

---

## Esquema de la hoja

Una fila por combustible. Un ticket bífuel genera dos filas con el mismo ID.

| Col | Campo | Origen |
|---|---|---|
| A | ID | automático |
| B | Timestamp | automático |
| C | Estación | Gemini, editable |
| D | Tipo Combustible | Gemini, editable |
| E | Litros | Gemini, editable |
| F | Precio por Litro (€) | Gemini, editable |
| G | Total Invertido (€) | Gemini, editable |
| H | KM Totales | manual |
| I | KM Recorridos (tramo) | calculado |
| J | Lectura KM GLP (coche) | manual |
| K | Lectura KM Gasolina (coche) | manual |
| L | KM GLP (tramo) | calculado |
| M | KM Gasolina (tramo) | calculado |
| N | Consumo coche (L/100km) | manual |
| O | Consumo real (L/100km) | calculado |
| P | Coste por KM real (€/km) | calculado |
| Q | Coste por KM coche (€/km) | calculado |
| R | Enlace Recibo | automático |
| S | KM de este combustible desde su último repostaje | calculado |

La hoja guarda valores, no fórmulas. `recalcularTodo()` regenera todas las columnas calculadas a partir de los datos de entrada.

---

## Cómo se calcula el consumo

El método es tanque a tanque: cuando repostas un combustible llenas ese depósito, así que los litros de este repostaje son exactamente los que gastaste desde el anterior.

- **Tramo de un combustible** = la lectura del parcial del coche, porque los parciales se resetean después de cada repostaje. Si no los reseteas, cambia `CONTADORES_SE_RESETEAN` a `false` y el tramo pasa a ser la diferencia entre lecturas.
- **KM del cálculo** = suma de los tramos de ese combustible desde la última vez que se repostó. Necesario porque no siempre se repostan los dos: puedes llenar solo GLP tres veces seguidas mientras la gasolina sigue acumulando kilómetros.
- **Consumo real** = litros ÷ km del cálculo × 100.
- **Coste por km real** = euros ÷ km del cálculo.
- **Consumo coche** y **coste por km coche** salen de lo que marca el ordenador de a bordo, y sirven para contrastar. El dashboard tiene un interruptor entre las dos versiones.

Cuando falta algún parcial de la ventana, el consumo se deja vacío en lugar de inventar un número. También aparece un aviso si los km de los dos combustibles no cuadran con el tramo total, que suele significar un parcial sin resetear.

---

## El dashboard

Indicadores de odómetro, gasto total, kilómetros y euros por combustible, coste por kilómetro de cada uno, cuántas veces sale más barato el GLP y el ahorro acumulado frente a haber ido solo con gasolina.

Gráficos de inversión y kilómetros por combustible, evolución del coste por kilómetro, del consumo y del precio por litro, precio medio por estación y gasto mensual.

---

## Aviso

Es un proyecto personal, pensado para un coche y un conductor. Funciona, pero no tiene tests, ni multiusuario, ni cuenta con que dos personas escriban a la vez. Cógelo como punto de partida.

## Licencia

MIT.