/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { registerGlobals } from '@livekit/react-native';
import App from './App';
import { name as appName } from './app.json';

// Sets up WebRTC for LiveKit voice and video calls; must run before any call is made
registerGlobals();

AppRegistry.registerComponent(appName, () => App);
