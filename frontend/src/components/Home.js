import React, { useState, useRef, useEffect } from "react";
import aang from "../assets/characters/aang2.png";
import hiro from "../assets/characters/hiro.png";
import angBackground from "../assets/backgrounds/avatarBackground.jpg";
import hiroBackground from "../assets/backgrounds/baymaxBackground.jpg";
import jasmineBackground from "../assets/backgrounds/aladdinBackground.jpg";
import Whiteboard from "./Whiteboard.tsx";
import { exportToBlob } from "tldraw";
import "tldraw/tldraw.css";
import axios from "axios";

import jasmine from "../assets/characters/jasmine.png";
import Cartesia from "@cartesia/cartesia-js";

import AITool from "./AITool.ts";
import "./SpeechBubble.css";

// Replace with your Deepgram API key
const deepgramApiKey = process.env.REACT_APP_DEEPGRAM_API_KEY;
const cartesiaAPIKey = process.env.REACT_APP_CARTESIA_API_KEY;
const cartesia = new Cartesia({
  apiKey: cartesiaAPIKey, // Replace with your actual API key
});

// Characters array
const characters = [
  { name: "Aang", src: aang, background: angBackground },
  { name: "Hiro", src: hiro, background: hiroBackground },
  { name: "Jasmine", src: jasmine, background: jasmineBackground },
];

// Character Voices Map
const characterVoices = {
  Aang: "37172f13-c9fe-47f1-aef0-3bd60836a5bf",
  Hiro: "211be958-0aea-490f-8a13-4ada04de9353",
  Jasmine: "6377eebe-ae73-44e0-854a-229fba6e76c8",
};

function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [collectedTranscript, setCollectedTranscript] = useState(""); // Store segments here
  const [sentiment, setSentiment] = useState("neutral"); // Store sentiment
  const [sentimentScore, setSentimentScore] = useState(0); // Store sentiment score
  const [image, setImage] = useState(null);
  const [selectedCharacter, setSelectedCharacter] = useState(characters[1]);
  const [showModal, setShowModal] = useState(false);
  const [chatHistory, setChatHistory] = useState([]); // Chat history array

  const [editor, setEditor] = useState(null);

  const handleSetEditor = (editorVal) => {
    setEditor(editorVal);
  }
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechBubbleText, setSpeechBubbleText] = useState("");

  const mediaRecorderRef = useRef(null);
  const socketRef = useRef(null); // Store WebSocket reference

  const isIpad = /iPad/i.test(navigator.userAgent); // Detect if the device is an iPad

  const startDeepgramStream = async () => {
    const socket = new WebSocket(
      `wss://api.deepgram.com/v1/listen?punctuate=true&model=enhanced&sentiment=true`,
      ["token", deepgramApiKey]
    );

    socketRef.current = socket; // Store the socket

    socket.onopen = () => {
      console.log("Connected to Deepgram WebSocket!");
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.start(250); // Send audio every 250ms

        mediaRecorderRef.current.ondataavailable = (event) => {
          socket.send(event.data); // Stream audio to Deepgram
        };
      });
    };

    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data);

        const newSegment = data.channel?.alternatives?.[0]?.transcript || "";
        const newSentiment = data.sentiments?.average?.sentiment || "neutral";
        const newSentimentScore =
          data.sentiments?.average?.sentiment_score || 0;

        console.log(`Transcript Segment: ${newSegment}`);
        console.log(`Sentiment: ${newSentiment} (Score: ${newSentimentScore})`);

        // Accumulate transcript segments
        setCollectedTranscript((prev) => prev + " " + newSegment);

        // Save the latest sentiment values
        setSentiment(newSentiment);
        setSentimentScore(newSentimentScore);
      } catch (error) {
        console.error("Error processing message:", error);
      }
    };

    socket.onclose = () => console.log("WebSocket closed.");
    socket.onerror = (error) => console.error("WebSocket error:", error);

    setIsRecording(true);
  };

  const playTTS = async (text, character, speed, emotion) => {
    setIsSpeaking(true);
    setSpeechBubbleText(text);

    const voiceId = characterVoices[character.name] || "default-voice-id"; // Fallback voice

    try {
      // Set up the WebSocket connection with the appropriate audio format
      const websocket = cartesia.tts.websocket({
        container: "raw",
        encoding: "pcm_f32le",
        sampleRate: 44100,
      });

      // Connect to the WebSocket
      await websocket.connect();

      // Send the TTS request with the selected character's voice
      const response = await websocket.send({
        model_id: "sonic-english", // Example model, adjust if necessary
        voice: {
          speed: speed || "normal",
          emotion: emotion || "neutral",
          mode: "id",
          id: voiceId, // Use the voice ID from the character's map
        },
        transcript: text || "that's really interesting can you tell me more?", // Default message if text is empty
      });

      // Extract the audio source from the response
      const { source } = response;

      // Create an AudioContext for playback
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const buffer = new Float32Array(source.durationToSampleCount(1));

      let audioData = [];

      // Read the audio stream and collect PCM data
      while (true) {
        const read = await source.read(buffer);
        audioData.push(...buffer.subarray(0, read));
        if (read < buffer.length) break; // No more audio to read
      }

      // Convert PCM data to AudioBuffer for playback
      const audioBuffer = audioContext.createBuffer(1, audioData.length, 44100);
      audioBuffer.getChannelData(0).set(audioData);

      // Create a buffer source for playback
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(audioContext.destination);

      // Play the audio
      sourceNode.start();

      // Set up an event listener for when the audio finishes playing
      sourceNode.onended = () => {
        setIsSpeaking(false);
        setSpeechBubbleText("");
      };

      // Disconnect WebSocket after use
      websocket.disconnect();
    } catch (error) {
      console.error("Error playing TTS:", error);
      setIsSpeaking(false);
      setSpeechBubbleText("");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
    }

    if (socketRef.current) {
      socketRef.current.close();
    }

    const handleExtractImage = async () => {
      const shapeIds = editor.getCurrentPageShapeIds();
      if (shapeIds.size === 0) return alert("Nothing on the canvas");
      const blob = await exportToBlob({
        editor: editor,
        ids: [...shapeIds],
        format: "png",
        opts: { background: false },
      });

      const reader = new FileReader();
      reader.readAsDataURL(blob);
      const base64Image = await new Promise((resolve) => {
        reader.onloadend = () => resolve(reader.result);
      });

      return base64Image;
    }

    const base64Image = await handleExtractImage();
    console.log("BASE64 IMAGE", base64Image);

    try {
      const response = await axios.post("http://localhost:3001/analyze-whiteboard",
        {
          transcript: collectedTranscript.trim(),
          base64Image: base64Image,
        })
      console.log("HERE IS THE RESPONSE", response.data);
    } catch (error) {
      console.log(error);
    }

    // Add the collected transcript and sentiment to chat history
    if (collectedTranscript.trim()) {
      addToChatHistory(
        "user",
        collectedTranscript.trim(),
        sentiment,
        sentimentScore
      );
    }

    // Reset collected transcript
    setCollectedTranscript("");
    setIsRecording(false);

    playTTS(
      "that's really interesting, can you tell me more? I really need you tell me a lot more so that this sentence takes up way more space, thanks so much for telling me such an interesting thing thats really really awesome",
      selectedCharacter
    );
  };

  const addToChatHistory = (role, content, sentiment, sentimentScore) => {
    const newEntry = { role, content, sentiment, sentimentScore };
    setChatHistory((prevHistory) => {
      const updatedHistory = [...prevHistory, newEntry];
      console.log("Updated Chat History:", updatedHistory); // Log the updated history
      return updatedHistory;
    });
  };

  const handleMicrophoneClick = () => {
    isRecording ? stopRecording() : startDeepgramStream();
  };

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const openModal = () => setShowModal(true);
  const closeModal = () => setShowModal(false);

  const selectCharacter = (character) => {
    setSelectedCharacter(character);
    closeModal();
  };

  return (
    <div
      style={{
        ...styles.container,
        backgroundImage: `linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 20%, rgba(255, 255, 255, 0) 80%, rgba(255, 255, 255, 1) 100%), url(${selectedCharacter.background})`,
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      }}
    >
      {isIpad ? ( // Conditional rendering based on device type
        <div style={{ width: "100%", height: "100%" }}>
          <Whiteboard updateEditor={handleSetEditor} />
        </div>
      ) : (
        <div style={styles.mainContent}>
          <div style={styles.leftPanel}>
            <div style={styles.whiteboardContainer}>
              <Whiteboard updateEditor={handleSetEditor} />
            </div>
          </div>
          <div style={styles.rightPanel}>
            <header style={styles.header}>Ask a Question!</header>
            <div style={styles.characterContainer}>
              <div style={styles.characterWrapper}>
                <img
                  src={selectedCharacter.src}
                  alt={selectedCharacter.name}
                  style={styles.characterImage}
                />
              </div>
              <button onClick={openModal} style={styles.changeCharacterButton}>
                Change Character
              </button>
            </div>
            <div style={styles.interactionArea}>
              <button
                onClick={handleMicrophoneClick}
                style={styles.microphoneButton}
              >
                <div
                  style={{
                    ...styles.microphoneCircle,
                    backgroundColor: isRecording ? "#ff4d4d" : "#f0f0f0",
                  }}
                >
                  <img
                    src="https://img.icons8.com/ios-filled/50/microphone.png"
                    alt="Microphone Icon"
                    style={styles.microphoneIcon}
                  />
                </div>
              </button>
              <div style={styles.microphoneText}>
                {isRecording && "Listening..."}
              </div>
              {transcript && (
                <div style={styles.transcriptBox}>
                  <p>{transcript}</p>
                </div>
              )}
            </div>

            {transcript && (
              <div style={styles.transcriptBox}>
                <p style={styles.transcriptText}>{transcript}</p>
              </div>
            )}

            {showModal && (
              <div style={styles.modal}>
                <h2>Select a Character</h2>
                {characters.map((char) => (
                  <div
                    key={char.name}
                    style={styles.characterOption}
                    onClick={() => selectCharacter(char)}
                  >
                    <p>{char.name}</p>
                  </div>
                ))}
                <button onClick={closeModal} style={styles.closeModalButton}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {isSpeaking && (
        <div className="speech-bubble" style={styles.speechBubblePosition}>
          <p style={styles.speechBubbleText}>{speechBubbleText}</p>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "95vh",
    width: "100vw", // Prevent scrolling
  },
  mainContent: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  leftPanel: {
    flex: "0 0 60%", // Adjusted to fit the whole screen with rightPanel
    display: "flex",
    flexDirection: "column",
    padding: "20px",
    backgroundColor: "transparent", // Make background transparent to show the container background
  },
  whiteboardContainer: {
    width: "100%",
    height: "100%", // Adjusted to fill the panel
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0 0 10px rgba(0,0,0,0.1)",
  },
  rightPanel: {
    flex: "0 0 40%", // Adjusted to fit the whole screen with leftPanel
    display: "flex",
    flexDirection: "column",
    padding: "20px",
    overflow: "hidden",
    backgroundPosition: "center",
    backgroundColor: "transparent", // Make background transparent to show the container background
    position: "relative", // Add this to make it a positioning context for the modal
  },
  header: {
    fontSize: "28px",
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: "20px",
    // backgroundColor: "lightgrey",
    // borderRadius: "8px",
    width: "50%",
    alignSelf: "center",
  },
  characterContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: "10px",
  },
  characterWrapper: {
    width: "400px",
    height: "500px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: "12px",
    marginBottom: "20px",
    position: "relative",
  },
  characterImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  changeCharacterButton: {
    padding: "12px 12px",
    fontSize: "18px",
    cursor: "pointer",
    border: "none",
    borderRadius: "8px",
    backgroundColor: "#007bff",
    color: "white",
  },
  interactionArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: "20px",
  },
  microphoneButton: {
    border: "none",
    backgroundColor: "transparent",
    cursor: "pointer",
    marginBottom: "10px",
  },
  microphoneCircle: {
    width: "100px",
    height: "100px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 0.3s ease",
  },
  microphoneIcon: {
    width: "40px",
    height: "40px",
  },
  microphoneText: {
    fontSize: "18px",
    marginTop: "10px",
    textAlign: "center",
    // backgroundColor: "lightgrey",
    // borderRadius: "8px",
    padding: "8px",
  },
  transcriptBox: {
    width: "100%",
    maxWidth: "400px",
    backgroundColor: "#f8f9fa",
    borderRadius: "12px",
    padding: "15px",
    boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
    textAlign: "center",
    marginTop: "20px",
  },
  modal: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: "white",
    padding: "20px",
    borderRadius: "8px",
    boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
    zIndex: 1000,
  },
  characterOption: {
    cursor: "pointer",
    padding: "10px",
    margin: "5px 0",
    borderRadius: "4px",
    transition: "background-color 0.3s ease",
  },
  closeModalButton: {
    marginTop: "10px",
    padding: "5px 10px",
    fontSize: "14px",
    cursor: "pointer",
    border: "none",
    borderRadius: "4px",
    backgroundColor: "#f0f0f0",
    color: "black",
  },
  speechBubblePosition: {
    position: "fixed",
    top: "20%",
    left: "70%", // Changed from 50% to 70% to shift right
    transform: "translateX(-50%)",
    zIndex: 1000,
  },
  speechBubbleText: {
    margin: 0,
    fontSize: "14px",
  },
};

export default Home;
