import {
  AudioVideoFacade,
  AudioVideoObserver,
  ConsoleLogger,
  ContentShareObserver,
  DefaultDeviceController,
  DefaultDOMWebSocketFactory,
  DefaultMeetingSession,
  DefaultModality,
  DefaultPromisedWebSocketFactory,
  DeviceChangeObserver,
  FullJitterBackoff,
  LogLevel,
  MeetingSession,
  MeetingSessionConfiguration,
  ReconnectingPromisedWebSocket
} from 'amazon-chime-sdk-js';
import React from 'react';

import getChimeContext from '../context/getChimeContext';
import DeviceType from '../types/DeviceType';
import MessageType from '../types/MessageType';
import RosterType from '../types/RosterType';
import getBaseUrl from '../utils/getBaseUrl';
import getMessagingWssUrl from '../utils/getMessagingWssUrl';

export class ChimeSdkWrapper
  implements AudioVideoObserver, ContentShareObserver, DeviceChangeObserver {
  meetingSession: MeetingSession;

  audioVideo: AudioVideoFacade;

  title: string;

  name: string;

  region: string;

  currentAudioInputDevice: DeviceType = {};

  currentAudioOutputDevice: DeviceType = {};

  currentVideoInputDevice: DeviceType = {};

  audioInputDevices: DeviceType[] = [];

  audioOutputDevices: DeviceType[] = [];

  videoInputDevices: DeviceType[] = [];

  roster: RosterType = {};

  rosterUpdateCallbacks: RosterType[] = [];

  configuration: MeetingSessionConfiguration = null;

  messagingSocket: ReconnectingPromisedWebSocket = null;

  messageUpdateCallbacks: MessageType[] = [];

  // eslint-disable-next-line
  createRoom = async (title: string, name: string, region: string): Promise<any> => {
    const response = await fetch(
      `${getBaseUrl()}join?title=${encodeURIComponent(
        title
      )}&name=${encodeURIComponent(name)}&region=${encodeURIComponent(region)}`,
      {
        method: 'POST'
      }
    );
    const json = await response.json();
    if (json.error) {
      throw new Error(`Server error: ${json.error}`);
    }

    const { JoinInfo } = json;
    this.configuration = new MeetingSessionConfiguration(
      JoinInfo.Meeting,
      JoinInfo.Attendee
    );
    await this.initializeMeetingSession(this.configuration);

    this.title = title;
    this.name = name;
    this.region = region;
  };

  initializeMeetingSession = async (
    configuration: MeetingSessionConfiguration
  ): Promise<void> => {
    const logger = new ConsoleLogger('SDK', LogLevel.DEBUG);
    const deviceController = new DefaultDeviceController(logger);
    this.meetingSession = new DefaultMeetingSession(
      configuration,
      logger,
      deviceController
    );
    this.audioVideo = this.meetingSession.audioVideo;

    this.audioInputDevices = [];
    (await this.audioVideo.listAudioInputDevices()).forEach(
      (mediaDeviceInfo: MediaDeviceInfo) => {
        this.audioInputDevices.push({
          label: mediaDeviceInfo.label,
          value: mediaDeviceInfo.deviceId
        });
      }
    );
    this.audioOutputDevices = [];
    (await this.audioVideo.listAudioOutputDevices()).forEach(
      (mediaDeviceInfo: MediaDeviceInfo) => {
        this.audioOutputDevices.push({
          label: mediaDeviceInfo.label,
          value: mediaDeviceInfo.deviceId
        });
      }
    );
    this.videoInputDevices = [];
    (await this.audioVideo.listVideoInputDevices()).forEach(
      (mediaDeviceInfo: MediaDeviceInfo) => {
        this.videoInputDevices.push({
          label: mediaDeviceInfo.label,
          value: mediaDeviceInfo.deviceId
        });
      }
    );
    this.devicesUpdatedCallbacks.forEach((devicesUpdatedCallback: Function) => {
      devicesUpdatedCallback();
    });
    this.audioVideo.addDeviceChangeObserver(this);

    this.audioVideo.realtimeSubscribeToAttendeeIdPresence(
      (presentAttendeeId: string, present: boolean): void => {
        if (!present) {
          delete this.roster[presentAttendeeId];
          this.publishRosterUpdate();
          return;
        }

        this.audioVideo.realtimeSubscribeToVolumeIndicator(
          presentAttendeeId,
          async (
            attendeeId: string,
            volume: number | null,
            muted: boolean | null,
            signalStrength: number | null
          ) => {
            const baseAttendeeId = new DefaultModality(attendeeId).base();
            if (baseAttendeeId !== attendeeId) {
              if (
                baseAttendeeId !==
                this.meetingSession.configuration.credentials.attendeeId
              ) {
                // TODO: stop my content share
              }
              return;
            }

            if (!this.roster[attendeeId]) {
              this.roster[attendeeId] = { name: '' };
            }
            if (volume !== null) {
              this.roster[attendeeId].volume = Math.round(volume * 100);
            }
            if (muted !== null) {
              this.roster[attendeeId].muted = muted;
            }
            if (signalStrength !== null) {
              this.roster[attendeeId].signalStrength = Math.round(
                signalStrength * 100
              );
            }
            if (!this.roster[attendeeId].name) {
              const response = await fetch(
                `${getBaseUrl()}attendee?title=${encodeURIComponent(
                  this.title
                )}&attendee=${encodeURIComponent(attendeeId)}`
              );
              const json = await response.json();
              this.roster[attendeeId].name = json.AttendeeInfo.Name || '';
            }
            this.publishRosterUpdate();
          }
        );
      }
    );
  };

  joinRoom = async (element: HTMLAudioElement): Promise<void> => {
    window.addEventListener(
      'unhandledrejection',
      (event: PromiseRejectionEvent) => {
        // eslint-disable-next-line
        console.error(event.reason);
      }
    );

    const audioInputs = await this.audioVideo.listAudioInputDevices();
    if (audioInputs && audioInputs.length > 0 && audioInputs[0].deviceId) {
      this.currentAudioInputDevice = {
        label: audioInputs[0].label,
        value: audioInputs[0].deviceId
      };
      await this.audioVideo.chooseAudioInputDevice(audioInputs[0].deviceId);
    }

    const audioOutputs = await this.audioVideo.listAudioOutputDevices();
    if (audioOutputs && audioOutputs.length > 0 && audioOutputs[0].deviceId) {
      this.currentAudioOutputDevice = {
        label: audioOutputs[0].label,
        value: audioOutputs[0].deviceId
      };
      await this.audioVideo.chooseAudioOutputDevice(audioOutputs[0].deviceId);
    }

    const videoInputs = await this.audioVideo.listVideoInputDevices();
    if (videoInputs && videoInputs.length > 0 && videoInputs[0].deviceId) {
      this.currentVideoInputDevice = {
        label: videoInputs[0].label,
        value: videoInputs[0].deviceId
      };
      await this.audioVideo.chooseVideoInputDevice(videoInputs[0].deviceId);
    }

    this.devicesUpdatedCallbacks.forEach((devicesUpdatedCallback: Function) => {
      devicesUpdatedCallback();
    });

    this.audioVideo.bindAudioElement(element);
    this.audioVideo.start();
  };

  joinRoomMessaging = async (): Promise<void> => {
    const messagingUrl = `${getMessagingWssUrl()}?MeetingId=${
      this.configuration.meetingId
    }&AttendeeId=${this.configuration.credentials.attendeeId}&JoinToken=${
      this.configuration.credentials.joinToken
    }`;
    this.messagingSocket = new ReconnectingPromisedWebSocket(
      messagingUrl,
      [],
      'arraybuffer',
      new DefaultPromisedWebSocketFactory(new DefaultDOMWebSocketFactory()),
      new FullJitterBackoff(1000, 0, 10000)
    );

    await this.messagingSocket.open(10000);

    this.messagingSocket.addEventListener('message', event => {
      try {
        const data = JSON.parse(event.data);
        const { attendeeId } = data.payload;

        let name;
        if (this.roster[attendeeId]) {
          name = this.roster[attendeeId].name;
        }

        this.publishMessageUpdate({
          type: data.type,
          payload: data.payload,
          timestampMs: Date.now(),
          name
        });
      } catch (error) {
        // eslint-disable-next-line
        console.error(error);
      }
    });
  };

  // eslint-disable-next-line
  sendMessage = (type: string, payload: any) => {
    if (!this.messagingSocket) {
      return;
    }
    const message = {
      message: 'sendmessage',
      data: JSON.stringify({ type, payload })
    };
    this.messagingSocket.send(JSON.stringify(message));
  };

  leaveRoom = async (end: boolean): Promise<void> => {
    this.audioVideo.stop();

    try {
      // eslint-disable-next-line
      if (end) {
        await fetch(
          `${getBaseUrl()}end?title=${encodeURIComponent(this.title)}`,
          {
            method: 'POST'
          }
        );
      }
    } catch (error) {
      // eslint-disable-next-line
      console.error(error);
    } finally {
      this.meetingSession = null;
      this.audioVideo = null;
      this.title = null;
      this.name = null;
      this.region = null;
      this.roster = {};
      this.rosterUpdateCallbacks = [];
      this.configuration = null;
      this.messagingSocket = null;
      this.messageUpdateCallbacks = [];
    }
  };

  leaveRoomMessaging = async (): Promise<void> => {
    await this.messagingSocket.close();
  };

  private devicesUpdatedCallbacks: ((devices: DeviceType[]) => void)[] = [];

  subscribeToDevicesUpdated = (devicesUpdatedCallback: () => void) => {
    this.devicesUpdatedCallbacks.push(devicesUpdatedCallback);
  };

  unsubscribeFromDevicesUpdated = (devicesUpdatedCallback: () => void) => {
    const index = this.devicesUpdatedCallbacks.indexOf(devicesUpdatedCallback);
    if (index !== -1) {
      this.devicesUpdatedCallbacks.splice(index, 1);
    }
  };

  /**
   * Called when audio inputs are changed.
   */
  audioInputsChanged?(freshAudioInputDeviceList?: MediaDeviceInfo[]): void {
    this.audioInputDevices = [];
    freshAudioInputDeviceList?.forEach((mediaDeviceInfo: MediaDeviceInfo) => {
      this.audioInputDevices.push({
        label: mediaDeviceInfo.label,
        value: mediaDeviceInfo.deviceId
      });
    });
    this.devicesUpdatedCallbacks.forEach((devicesUpdatedCallback: Function) => {
      devicesUpdatedCallback();
    });
  }

  /**
   * Called when audio outputs are changed.
   */
  audioOutputsChanged?(freshAudioOutputDeviceList?: MediaDeviceInfo[]): void {
    this.audioOutputDevices = [];
    freshAudioOutputDeviceList?.forEach((mediaDeviceInfo: MediaDeviceInfo) => {
      this.audioOutputDevices.push({
        label: mediaDeviceInfo.label,
        value: mediaDeviceInfo.deviceId
      });
    });
    this.devicesUpdatedCallbacks.forEach((devicesUpdatedCallback: Function) => {
      devicesUpdatedCallback();
    });
  }

  /**
   * Called when video inputs are changed.
   */
  videoInputsChanged?(freshVideoInputDeviceList?: MediaDeviceInfo[]): void {
    this.videoInputDevices = [];
    freshVideoInputDeviceList?.forEach((mediaDeviceInfo: MediaDeviceInfo) => {
      this.videoInputDevices.push({
        label: mediaDeviceInfo.label,
        value: mediaDeviceInfo.deviceId
      });
    });
    this.devicesUpdatedCallbacks.forEach((devicesUpdatedCallback: Function) => {
      devicesUpdatedCallback();
    });
  }

  private rosterUpdateCallbacks: RosterType[] = [];

  subscribeToRosterUpdate = (callback: (roster: RosterType) => void) => {
    this.rosterUpdateCallbacks.push(callback);
  };

  unsubscribeFromRosterUpdate = (callback: (roster: RosterType) => void) => {
    const index = this.rosterUpdateCallbacks.indexOf(callback);
    if (index !== -1) {
      this.rosterUpdateCallbacks.splice(index, 1);
    }
  };

  private publishRosterUpdate = () => {
    for (let i = 0; i < this.rosterUpdateCallbacks.length; i += 1) {
      const callback = this.rosterUpdateCallbacks[i];
      callback(this.roster);
    }
  };

  subscribeToMessageUpdate = (callback: (message: MessageType) => void) => {
    this.messageUpdateCallbacks.push(callback);
  };

  unsubscribeFromMessageUpdate = (callback: (message: MessageType) => void) => {
    const index = this.messageUpdateCallbacks.indexOf(callback);
    if (index !== -1) {
      this.messageUpdateCallbacks.splice(index, 1);
    }
  };

  private publishMessageUpdate = (message: MessageType) => {
    for (let i = 0; i < this.messageUpdateCallbacks.length; i += 1) {
      const callback = this.messageUpdateCallbacks[i];
      callback(message);
    }
  };
}

type Props = {
  children: ReactNode;
};

export default function ChimeProvider(props: Props) {
  const { children } = props;
  const chimeSdkWrapper = new ChimeSdkWrapper();
  const ChimeContext = getChimeContext();
  return (
    <ChimeContext.Provider value={chimeSdkWrapper}>
      {children}
    </ChimeContext.Provider>
  );
}
