import {useEffect, useState} from 'react';
import {Dimensions, Keyboard} from 'react-native';

// How much of the bottom of the screen the keyboard covers, so a form can scroll above it on every phone
// (with the edge-to-edge window the screen does not always shrink for the keyboard on Android).
export default function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e =>
      setHeight(
        Math.max(0, Dimensions.get('screen').height - e.endCoordinates.screenY),
      ),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
