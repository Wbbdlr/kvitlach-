import AgoraRTC from "agora-rtc-sdk-ng"

// Default state values
const DEFAULT_STATE = {
  channel: {
    localAudioTrack: null,
    remoteAudioTrack: null,
    remoteUid: null,
  },
  isMuted: true,
  joined: false,
  agoraEngine: null,
  currentView: null,
  isConnecting: false
};

// Consolidated state management
const state = { ...DEFAULT_STATE };

/**
 * Validates required Agora options
 * @param {Object} options - Agora configuration options
 * @throws {Error} If required fields are missing
 */
function validateAgoraOptions(options) {
  const required = ['appId', 'channel', 'uid'];
  for (const field of required) {
    if (!options[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

/**
 * Updates UI elements based on mute state
 * @param {boolean} isMuted - Current mute state
 */
function updateMuteUI(isMuted) {
  const mutedElement = document.getElementById('muted');
  const unmutedElement = document.getElementById('unmuted');
  const toggleMuteButton = document.getElementById('toggle-mute');
  
  if (!toggleMuteButton || !mutedElement || !unmutedElement) return;
  
  toggleMuteButton.classList.toggle("bg-gray-100", isMuted);
  toggleMuteButton.classList.toggle("bg-white", !isMuted);
  mutedElement.style.display = isMuted ? "block" : "none";
  unmutedElement.style.display = isMuted ? "none" : "block";
}

/**
 * Joins the Agora channel without publishing
 */
async function joinChannelAsListener() {
  if (state.joined) return;

  try {
    validateAgoraOptions(agoraOptions);
    
    await state.agoraEngine.join(
      agoraOptions.appId,
      agoraOptions.channel,
      null,
      agoraOptions.uid
    );
    
    state.joined = true;
    console.log("Joined channel as listener");
  } catch (error) {
    console.error('Error joining channel as listener:', error);
    state.joined = false;
    throw error;
  }
}

/**
 * Publishes audio to the Agora channel
 */
async function publishAudio() {
  if (!state.joined) {
    throw new Error('Must join channel before publishing');
  }

  try {
    // Create track
    state.channel.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    
    // Enable track before publishing
    state.channel.localAudioTrack.setEnabled(true);
    
    // Publish the track
    await state.agoraEngine.publish(state.channel.localAudioTrack);
    console.log("Published audio track successfully");
  } catch (error) {
    console.error('Error publishing audio:', error);
    throw error;
  }
}

/**
 * Sets up mute toggle functionality
 */
async function setupVoiceChannel() {
  if (state.isConnecting) return;
  
  state.isConnecting = true;
  try {
    await initializeAgoraEngine();
    
    // First join as listener if not already joined
    if (!state.joined) {
      await joinChannelAsListener();
    }
    
    // Then publish audio
    await publishAudio();
    
    // Update state and UI
    state.isMuted = false;
    updateMuteUI(false);
  } catch (error) {
    console.error('Error setting up voice channel:', error);
    state.isMuted = true;
    updateMuteUI(true);
    await cleanup();
  } finally {
    state.isConnecting = false;
  }
}

function setupMuteToggle() {
  const toggleMuteButton = document.getElementById('toggle-mute');
  console.log("setupMuteToggle", toggleMuteButton)
  if (!toggleMuteButton) return;

  updateMuteUI(state.isMuted);

  toggleMuteButton.onclick = async function () {
    // Prevent actions while connecting
    if (state.isConnecting) return;
    console.log()

    try {
      if (state.isMuted) {
        if (!state.channel.localAudioTrack) {
          await setupVoiceChannel();
        } else {
          state.isMuted = false;
          updateMuteUI(false);
          await state.channel.localAudioTrack.setEnabled(true);
        }
      } else {
        state.isMuted = true;
        updateMuteUI(true);
        await state.channel.localAudioTrack?.setEnabled(false);
      }
    } catch (error) {
      console.error('Error toggling mute:', error);
      state.isMuted = true;
      updateMuteUI(true);
    }
  };
}

/**
 * Handles remote user publishing audio/video
 * @param {Object} user - Remote user object
 * @param {string} mediaType - Type of media being published
 */
async function handleUserPublished(user, mediaType) {
  try {
    await state.agoraEngine.subscribe(user, mediaType);
    console.log("subscribe success");

    if (mediaType === "audio") {
      state.channel.remoteUid = user.uid;
      state.channel.remoteAudioTrack = user.audioTrack;
      state.channel.remoteAudioTrack.play();
    }
  } catch (error) {
    console.error('Error handling user published:', error);
  }
}

/**
 * Handles remote user unpublishing
 * @param {Object} user - Remote user object
 */
function handleUserUnpublished(user) {
  if (state.channel.remoteUid === user.uid) {
    state.channel.remoteAudioTrack?.stop();
    state.channel.remoteAudioTrack = null;
    state.channel.remoteUid = null;
  }
  console.log(`${user.uid} has left the channel`);
}

/**
 * Initializes the Agora engine and sets up event handlers
 */
function initializeAgoraEngine() {
  if (state.agoraEngine) {
    return;
  }

  try {
    state.agoraEngine = AgoraRTC.createClient({ mode: "rtc", codec: "vp9" });
    state.agoraEngine.on("user-published", handleUserPublished);
    state.agoraEngine.on("user-unpublished", handleUserUnpublished);
  } catch (error) {
    console.error('Error initializing Agora engine:', error);
    throw error;
  }
}

/**
 * Cleans up Agora resources
 */
export async function cleanup() {
  console.log("cleanup");
  try {
    // Clean up tracks first
    if (state.channel.localAudioTrack) {
      await state.channel.localAudioTrack.setEnabled(false);
      state.channel.localAudioTrack.close();
    }
    if (state.channel.remoteAudioTrack) {
      state.channel.remoteAudioTrack.stop();
    }
    
    // Leave the channel if joined
    if (state.joined && state.agoraEngine) {
      await state.agoraEngine.leave();
    }

    // Clean up the engine
    if (state.agoraEngine) {
      state.agoraEngine.removeAllListeners();
    }

    // Reset all state to defaults
    Object.assign(state, DEFAULT_STATE);
    updateMuteUI(true);
  } catch (error) {
    console.error('Error during cleanup:', error);
    // Force reset state even if cleanup fails
    Object.assign(state, DEFAULT_STATE);
  }
}

/**
 * Starts the basic call functionality
 */
export function startBasicCall(view) {
  if (!view) {
    console.error('View parameter is required');
    return;
  }

  // Prevent duplicate initialization for same view
  if (state.currentView === view) return;
  
  try {
    // Clean up previous instance if exists
    if (state.currentView) {
      cleanup();
    }
    
    state.currentView = view;
    setupMuteToggle();
    
    // Join as listener immediately
    initializeAgoraEngine();
    joinChannelAsListener().catch(error => {
      console.error('Error joining as listener:', error);
    });
  } catch (error) {
    console.error('Error starting basic call:', error);
    cleanup();
  }
}
