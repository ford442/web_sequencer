import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TEMPO } from '../../constants'
import type { ReverbType } from '../../types'

export function useTransportMixState() {
    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [swing, setSwing] = useState<number>(0)
    const tempoRef = useRef(tempo);
    useEffect(() => { tempoRef.current = tempo; }, [tempo]);
    const lastFreqRef = useRef<Record<string, number>>({ partA: 0, partB: 0 });

    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [backgroundImage, setBackgroundImage] = useState<string>('')
    const [masterVolume, setMasterVolume] = useState(0.8)
    const [masterSaturation, setMasterSaturation] = useState(0)
    const [globalPan, setGlobalPan] = useState(0)
    const [reverbType, setReverbType] = useState<ReverbType>('plate')

    return {
        tempo, setTempo, tempoRef,
        swing, setSwing,
        lastFreqRef,
        ambianceUrl, setAmbianceUrl,
        backgroundImage, setBackgroundImage,
        masterVolume, setMasterVolume,
        masterSaturation, setMasterSaturation,
        globalPan, setGlobalPan,
        reverbType, setReverbType,
    }
}
