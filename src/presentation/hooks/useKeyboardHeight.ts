// Reports the current software keyboard height (0 when hidden).
//
// Why not KeyboardAvoidingView: Expo 56 / RN 0.85 runs Android edge-to-edge,
// where windowSoftInputMode=adjustResize no longer shrinks the window — the
// keyboard just overlays the app, so KAV behavior="height" does nothing.
// The keyboard events still report the real height in edge-to-edge, so we
// pad the layout manually.

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS fires the richer "will" events (smoother); Android only "did".
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
