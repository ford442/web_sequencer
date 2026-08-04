import { describe, expect, it } from 'vitest';

import { buildKnob2DDrawCalls } from '../../knobRender';
import { KNOB_MATERIAL } from '../../knobMaterial';

import { TEST_DIMS } from './shared';

describe('holographic knob derivation contract', () => {
    it('snapshots Canvas2D draw-call sequence for value 1.0', () => {
        expect(buildKnob2DDrawCalls(KNOB_MATERIAL, 1.0, TEST_DIMS)).toMatchInlineSnapshot(`
          [
            {
              "op": "fillStyle",
              "value": "#0d0f13",
            },
            {
              "args": [
                0,
                0,
                100,
                100,
              ],
              "op": "fillRect",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                55.00000000000001,
                0,
                6.283185307179586,
              ],
              "op": "arc",
            },
            {
              "op": "strokeStyle",
              "value": "#00e5ff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                23.483495705504463,
                76.51650429449553,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                17.11953467482553,
                82.88046532517446,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#33ffff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                11,
                49.99999999999999,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                5,
                49.99999999999999,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#00bfd9",
            },
            {
              "op": "lineWidth",
              "value": 1,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                22.422835533724648,
                22.422835533724644,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                18.180194846605364,
                18.18019484660536,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#00bfd9",
            },
            {
              "op": "lineWidth",
              "value": 1,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                12.5,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                50,
                3.5,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#33ffff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                77.57716446627535,
                22.422835533724648,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                81.81980515339464,
                18.180194846605364,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#00bfd9",
            },
            {
              "op": "lineWidth",
              "value": 1,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                89,
                50,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                95,
                50,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#00bfd9",
            },
            {
              "op": "lineWidth",
              "value": 1,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                76.51650429449553,
                76.51650429449553,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                82.88046532517447,
                82.88046532517446,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#33ffff",
            },
            {
              "op": "lineWidth",
              "value": 2,
            },
            {
              "op": "stroke",
            },
            {
              "op": "font",
              "value": "bold 9px monospace",
            },
            {
              "op": "textAlign",
              "value": "center",
            },
            {
              "op": "textBaseline",
              "value": "middle",
            },
            {
              "op": "fillStyle",
              "value": "#80e6ff",
            },
            {
              "args": [
                "0",
                14.291107550079339,
                85.70889244992065,
              ],
              "op": "fillText",
            },
            {
              "args": [
                "50",
                50,
                -0.5,
              ],
              "op": "fillText",
            },
            {
              "args": [
                "100",
                85.70889244992065,
                85.70889244992065,
              ],
              "op": "fillText",
            },
            {
              "args": [
                20.301515190165,
                79.698484809835,
                79.698484809835,
                79.698484809835,
              ],
              "id": "valueArc",
              "op": "createLinearGradient",
            },
            {
              "args": [
                0,
                "#009980",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "args": [
                1,
                "#33ffcc",
              ],
              "id": "valueArc",
              "op": "addColorStop",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
                42,
                -3.9269908169872414,
                0.7853981633974483,
              ],
              "op": "arc",
            },
            {
              "id": "valueArc",
              "op": "strokeStyleGradient",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                21.89250544783473,
                78.10749455216526,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                19.26737152267967,
                80.73262847732032,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#002633",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
            {
              "op": "fillStyle",
              "value": "#002633",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                20.301515190165,
                79.698484809835,
                0.7875,
                0,
                6.283185307179586,
              ],
              "op": "arc",
            },
            {
              "op": "fill",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                10.25,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                50,
                6.537500000000001,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#002633",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
            {
              "op": "fillStyle",
              "value": "#002633",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                8,
                0.7875,
                0,
                6.283185307179586,
              ],
              "op": "arc",
            },
            {
              "op": "fill",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                78.10749455216526,
                78.10749455216526,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                80.73262847732032,
                80.73262847732032,
              ],
              "op": "lineTo",
            },
            {
              "op": "strokeStyle",
              "value": "#002633",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
            {
              "op": "fillStyle",
              "value": "#002633",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                79.698484809835,
                79.698484809835,
                0.7875,
                0,
                6.283185307179586,
              ],
              "op": "arc",
            },
            {
              "op": "fill",
            },
            {
              "op": "fillStyle",
              "value": "#0d141f",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                45.757359312880716,
                45.757359312880716,
                4,
                2,
                3.9269908169872414,
                0,
                6.283185307179586,
              ],
              "op": "ellipse",
            },
            {
              "op": "fill",
            },
            {
              "args": [
                50,
                50,
                85.35533905932738,
                85.35533905932738,
              ],
              "id": "needleBody",
              "op": "createLinearGradient",
            },
            {
              "args": [
                0,
                "#0d141f",
              ],
              "id": "needleBody",
              "op": "addColorStop",
            },
            {
              "args": [
                0.55,
                "#d1dbe6",
              ],
              "id": "needleBody",
              "op": "addColorStop",
            },
            {
              "args": [
                1,
                "#ffffff",
              ],
              "id": "needleBody",
              "op": "addColorStop",
            },
            {
              "op": "beginPath",
            },
            {
              "args": [
                50,
                50,
              ],
              "op": "moveTo",
            },
            {
              "args": [
                85.35533905932738,
                85.35533905932738,
              ],
              "op": "lineTo",
            },
            {
              "id": "needleBody",
              "op": "strokeStyleGradient",
            },
            {
              "op": "lineWidth",
              "value": 3,
            },
            {
              "op": "stroke",
            },
          ]
        `);
    });
});
