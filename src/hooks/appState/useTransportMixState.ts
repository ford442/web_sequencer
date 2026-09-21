import { transportMixStore, useTransportMixStore } from '../../stores/transportMixStore'

export function useTransportMixState() {
    const state = useTransportMixStore();

    return {
        tempo: state.tempo, setTempo: transportMixStore.setTempo, tempoRef: transportMixStore.tempoRef,
        swing: state.swing, setSwing: transportMixStore.setSwing,
        lastFreqRef: transportMixStore.lastFreqRef,
        ambianceUrl: state.ambianceUrl, setAmbianceUrl: transportMixStore.setAmbianceUrl,
        backgroundImage: state.backgroundImage, setBackgroundImage: transportMixStore.setBackgroundImage,
        masterVolume: state.masterVolume, setMasterVolume: transportMixStore.setMasterVolume,
        masterSaturation: state.masterSaturation, setMasterSaturation: transportMixStore.setMasterSaturation,
        globalPan: state.globalPan, setGlobalPan: transportMixStore.setGlobalPan,
        reverbType: state.reverbType, setReverbType: transportMixStore.setReverbType,
    }
}
