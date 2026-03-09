/*
 * Copyright 2026 UCP Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useEffect, useRef, useState } from "react";
import ChatInput from "./components/ChatInput";
import ChatMessageComponent from "./components/ChatMessage";
import Header from "./components/Header";
import { appConfig } from "./config";
import { CredentialProviderProxy } from "./mocks/credentialProviderProxy";

import {
  type ChatMessage,
  type PaymentInstrument,
  type Product,
  Sender,
  type Checkout,
  type PaymentHandler,
} from "./types";

type RequestPart =
  | { type: "text"; text: string }
  | { type: "data"; data: Record<string, unknown> };

function createChatMessage(
  sender: Sender,
  text: string,
  props: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    sender,
    text,
    ...props,
  };
}

const initialMessage: ChatMessage = createChatMessage(
  Sender.MODEL,
  appConfig.defaultMessage,
  { id: "initial" },
);

/**
 * An example A2A chat client that demonstrates consuming a business's A2A Agent with UCP Extension.
 * Only for demo purposes, not intended for production use.
 */
function App() {
  const [user_email, _setUserEmail] = useState<string | null>(
    "foo@example.com",
  );
  const [skipDetailConfirmation, setSkipDetailConfirmation] = useState(false);
  // Preset customer details
  const [firstName] = useState<string>("John");
  const [lastName] = useState<string>("Doe");
  const [streetAddress] = useState<string>("123 Main St");
  const [addressLocality] = useState<string>("Anytown");
  const [addressRegion] = useState<string>("CA");
  const [postalCode] = useState<string>("90210");
  const [addressCountry] = useState<string>("US");
  const [extendedAddress] = useState<string | null>(null); // Optional

  const defaultCustomerDetails = {
    firstName,
    lastName,
    email: user_email,
    address: {
      street_address: streetAddress,
      extended_address: extendedAddress,
      address_locality: addressLocality,
      address_region: addressRegion,
      postal_code: postalCode,
      address_country: addressCountry,
    },
  };

  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [contextId, setContextId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const credentialProvider = useRef(new CredentialProviderProxy());
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom when new messages are added
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleAddToCheckout = (productToAdd: Product) => {
    const actionPayload = JSON.stringify({
      action: "add_to_checkout",
      product_id: productToAdd.productID,
      quantity: 1,
    });
    handleSendMessage(actionPayload, { isUserAction: true });
  };

  const handleStartPayment = () => {
    // If the user previously requested to skip detail confirmation,
    // automatically proceed with using the default details.
    if (skipDetailConfirmation) {
      // call the async handler but don't block UI
      void handleUseDefaultDetails();
      return;
    }

    // Otherwise, display a confirmation message and wait for the user
    // to choose whether to proceed with defaults or edit manually.
    const confirmationMessage: ChatMessage = createChatMessage(Sender.MODEL, "", {
      showCustomerDetailsConfirmation: true,
      customerDetails: defaultCustomerDetails,
    });
    setMessages((prev) => [...prev, confirmationMessage]);
    // The actual payment start will be triggered by user's confirmation
  };

  const handleUseDefaultDetails = async () => {
    // Remove the confirmation prompt message from the UI
    setMessages((prev) => prev.filter((msg) => !msg.showCustomerDetailsConfirmation));

    const userActionMessage = createChatMessage(
      Sender.USER,
      `User confirmed using default details.`,
      { isUserAction: true },
    );
    setMessages((prev) => [...prev, userActionMessage]);
    setIsLoading(true); // Set loading state for the subsequent API calls

    try {
      // Proactively send preset customer details to the agent
      const customerDetailsPayload: RequestPart[] = [
        {
          type: "data",
          data: {
            action: "update_customer_details",
            first_name: firstName,
            last_name: lastName,
            street_address: streetAddress,
            address_locality: addressLocality,
            address_region: addressRegion,
            postal_code: postalCode,
            address_country: addressCountry,
            ...(extendedAddress && { extended_address: extendedAddress }),
            ...(user_email && { email: user_email }),
          },
        },
      ];

      // Send customer details. We already appended a clear user action message
      // above so tell `handleSendMessage` not to add another user-action entry
      // for this internal request (avoid duplicate/ephemeral messages).
      await handleSendMessage(customerDetailsPayload, {
        isUserAction: false,
      });

      // Now, proceed to start the payment process and let that be treated
      // as a user action so it's visible in the chat's activity stream.
      const actionPayload = JSON.stringify({ action: "start_payment" });
      await handleSendMessage(actionPayload, {
        isUserAction: true,
      });

      // Append a persistent model message that explicitly shows the
      // customer details used so the user can see exactly what was sent.
      const detailsTextLines = [
        `Using default customer details:`,
        `Name: ${firstName} ${lastName}`,
        `Email: ${user_email ?? "(none)"}`,
        `Address: ${streetAddress}, ${addressLocality}, ${addressRegion} ${postalCode}, ${addressCountry}`,
      ];
      const detailsMessage = createChatMessage(
        Sender.MODEL,
        detailsTextLines.join("\n"),
      );
      setMessages((prev) => [...prev, detailsMessage]);

    } catch (error) {
      console.error("Error confirming default details:", error);
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, there was an issue processing your default details.",
      );
      setMessages((prev) => [...prev.slice(0, -1), errorMessage]); // Replace loading with error
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateDetailsManually = async () => {
    // Remove the confirmation prompt message from the UI
    setMessages((prev) => prev.filter((msg) => !msg.showCustomerDetailsConfirmation));

    const userActionMessage = createChatMessage(
      Sender.USER,
      `User chose to update details manually.`,
      { isUserAction: true },
    );
    setMessages((prev) => [...prev, userActionMessage]);
    setIsLoading(true); // Set loading state for the subsequent API call

    try {
      // Proceed with the original flow: send only the start_payment action
      // The agent will then prompt for required details.
      const actionPayload = JSON.stringify({ action: "start_payment" });
      await handleSendMessage(actionPayload, {
        isUserAction: true,
      });
    } catch (error) {
      console.error("Error choosing manual update:", error);
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, there was an issue initiating manual detail update.",
      );
      setMessages((prev) => [...prev.slice(0, -1), errorMessage]); // Replace loading with error
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentMethodSelection = async (checkout: Checkout) => {
    if (!checkout || !checkout.payment || !checkout.payment.handlers) {
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, I couldn't retrieve payment methods.",
      );
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    //find the handler with id "example_payment_provider"
    const handler = checkout.payment.handlers.find(
      (handler: PaymentHandler) => handler.id === "example_payment_provider",
    );
    if (!handler) {
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, I couldn't find the supported payment handler.",
      );
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    try {
      const paymentResponse =
        await credentialProvider.current.getSupportedPaymentMethods(
          user_email,
          handler.config,
        );
      const paymentMethods = paymentResponse.payment_method_aliases;

      // Automatically select the first payment method instead of displaying choices
      if (paymentMethods && paymentMethods.length > 0) {
        const defaultSelectedMethod = paymentMethods[0];
        console.log(`Automatically selecting payment method: ${defaultSelectedMethod.id}`);
        await handlePaymentMethodSelected(defaultSelectedMethod.id);
      } else {
        const errorMessage = createChatMessage(
          Sender.MODEL,
          "Sorry, no payment methods were found.",
        );
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error("Failed to resolve mandate:", error);
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, I couldn't retrieve payment methods.",
      );
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  const handlePaymentMethodSelected = async (selectedMethod: string) => {
    // Hide the payment selector by removing it from the messages
    setMessages((prev) => prev.filter((msg) => !msg.paymentMethods));

    // Add a temporary user message
    const userActionMessage = createChatMessage(
      Sender.USER,
      `User selected payment method: ${selectedMethod}`,
      { isUserAction: true },
    );
    setMessages((prev) => [...prev, userActionMessage]);

    try {
      if (!user_email) {
        throw new Error("User email is not set.");
      }

      const paymentInstrument =
        await credentialProvider.current.getPaymentToken(
          user_email,
          selectedMethod,
        );

      if (!paymentInstrument || !paymentInstrument.credential) {
        throw new Error("Failed to retrieve payment credential");
      }

      await handleConfirmPayment(paymentInstrument);
    } catch (error) {
      console.error("Failed to process payment mandate:", error);
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, I couldn't process the payment. Please try again.",
      );
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  const handleConfirmPayment = async (paymentInstrument: PaymentInstrument) => {
    // Hide the payment confirmation component
    const userActionMessage = createChatMessage(
      Sender.USER,
      `User confirmed payment.`,
      { isUserAction: true },
    );
    // Let handleSendMessage manage the loading indicator
    setMessages((prev) => [
      ...prev.filter((msg) => !msg.paymentInstrument),
      userActionMessage,
    ]);

    try {
      const parts: RequestPart[] = [
        { type: "data", data: { action: "complete_checkout" } },
        {
          type: "data",
          data: {
            "a2a.ucp.checkout.payment_data": paymentInstrument,
            "a2a.ucp.checkout.risk_signals": { data: "some risk data" },
          },
        },
      ];

      await handleSendMessage(parts, {
        isUserAction: true,
      });
    } catch (error) {
      console.error("Error confirming payment:", error);
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, there was an issue confirming your payment.",
      );
      // If handleSendMessage wasn't called, we might need to manually update state
      // In this case, we remove the loading indicator that handleSendMessage would have added
      setMessages((prev) => [...prev.slice(0, -1), errorMessage]); // This assumes handleSendMessage added a loader
      setIsLoading(false); // Ensure loading is stopped on authorization error
    }
  };

  const handleSendMessage = async (
    messageContent: string | RequestPart[],
    options?: { isUserAction?: boolean; headers?: Record<string, string> },
  ) => {
    // START_CHANGE: Ensure isLoading is respected even for complex data types
    // Remove the `if (isLoading) return;` if you want to queue messages,
    // otherwise keep it to prevent multiple concurrent requests.
    if (isLoading) return;
    // END_CHANGE

    // Check if the message contains instruction to skip detail confirmation.
    // This flag will be used by handleStartPayment to bypass the confirmation prompt.
    if (typeof messageContent === "string" &&
        ((messageContent.toLowerCase().includes("use the default"))
         || (messageContent.toLowerCase().includes("my usual")))) {
      setSkipDetailConfirmation(true);
    }

    let userActionText = "<User Action>"; // Default fallback

    if (options?.isUserAction) {
      if (typeof messageContent === "string") {
        try {
          const parsedContent = JSON.parse(messageContent);
          if (parsedContent.action === "add_to_checkout") {
            userActionText = `One item added to cart (ID: ${parsedContent.product_id}).`;
          } else if (parsedContent.action === "start_payment") {
            userActionText = "Initiating payment process through Stripe.";
          }
        } catch (e) {
          // Not a valid JSON string or action not found, keep default
        }
      } else if (Array.isArray(messageContent)) { // RequestPart[]
        for (const part of messageContent) {
          if (part.type === "data" && part.data?.action) {
            if (part.data.action === "update_customer_details") {
              userActionText = "Default customer details confirmed.";
              break; 
            } else if (part.data.action === "complete_checkout") {
              userActionText = "Payment confirmed.";
              break; 
            }
          }
        }
      }
    } else {
      userActionText = typeof messageContent === "string"
        ? messageContent
        : "Data sent";
    }

    const userMessage = createChatMessage(
      Sender.USER,
      userActionText,
    );
    if (userMessage.text) {
      // Only add if there's text
      setMessages((prev) => [...prev, userMessage]);
    }
    // START_CHANGE: Ensure a loading message is always added before an API call
    setMessages((prev) => [
      ...prev,
      createChatMessage(Sender.MODEL, "", { isLoading: true }),
    ]);
    setIsLoading(true);
    // END_CHANGE

    try {
      const requestParts =
        typeof messageContent === "string"
          ? [{ type: "text", text: messageContent }]
          : messageContent;

      const requestParams: {
        message: {
          role: string;
          parts: RequestPart[];
          messageId: string;
          kind: string;
          contextId?: string;
          taskId?: string;
        };
        configuration: {
          historyLength: number;
        };
      } = {
        message: {
          role: "user",
          parts: requestParts,
          messageId: crypto.randomUUID(),
          kind: "message",
        },
        configuration: {
          historyLength: 0,
        },
      };

      if (contextId) {
        requestParams.message.contextId = contextId;
      }
      if (taskId) {
        requestParams.message.taskId = taskId;
      }

      const defaultHeaders = {
        "Content-Type": "application/json",
        "X-A2A-Extensions":
          "https://ucp.dev/specification/reference?v=2026-01-11",
        "UCP-Agent":
          'profile="http://localhost:3000/profile/agent_profile.json"',
      };

      const response = await fetch("/api", {
        method: "POST",
        headers: { ...defaultHeaders, ...options?.headers },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method: "message/send",
          params: requestParams,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();

      // Update context and task IDs from the response for subsequent requests
      if (data.result?.contextId) {
        setContextId(data.result.contextId);
      }
      //if there is a task and it's in one of the active states
      if (
        data.result?.id &&
        data.result?.status?.state in ["working", "submitted", "input-required"]
      ) {
        setTaskId(data.result.id);
      } else {
        //if not reset taskId
        setTaskId(undefined);
      }

      const combinedBotMessage = createChatMessage(Sender.MODEL, "");

      const responseParts =
        data.result?.parts || data.result?.status?.message?.parts || [];

      for (const part of responseParts) {
        if (part.text) {
          // Simple text
          combinedBotMessage.text +=
            (combinedBotMessage.text ? "\n" : "") + part.text;
        } else if (part.data?.["a2a.product_results"]) {
          // Product results
          combinedBotMessage.text +=
            (combinedBotMessage.text ? "\n" : "") +
            (part.data["a2a.product_results"].content || "");
          combinedBotMessage.products =
            part.data["a2a.product_results"].results;
        } else if (part.data?.["a2a.ucp.checkout"]) {
          // Checkout
          combinedBotMessage.checkout = part.data["a2a.ucp.checkout"];
        }
      }

      const newMessages: ChatMessage[] = [];
      const hasContent =
        combinedBotMessage.text ||
        combinedBotMessage.products ||
        combinedBotMessage.checkout;
      if (hasContent) {
        newMessages.push(combinedBotMessage);
      }

      if (newMessages.length > 0) {
        setMessages((prev) => [...prev.slice(0, -1), ...newMessages]);
      } else {
        const fallbackResponse =
          "Sorry, I received a response I couldn't understand.";
        setMessages((prev) => [
          ...prev.slice(0, -1),
          createChatMessage(Sender.MODEL, fallbackResponse),
        ]);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage = createChatMessage(
        Sender.MODEL,
        "Sorry, something went wrong. Please try again.",
      );
      // Replace the placeholder with the error message
      setMessages((prev) => [...prev.slice(0, -1), errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const lastCheckoutIndex = messages.map((m) => !!m.checkout).lastIndexOf(true);

  return (
    <div className="flex flex-col h-screen max-h-screen bg-white font-sans">
      <Header logoUrl={appConfig.logoUrl} title={appConfig.name} />
      <main
        ref={chatContainerRef}
        className="flex-grow overflow-y-auto p-4 md:p-6 space-y-2"
      >
        {messages.map((msg, index) => (
          <ChatMessageComponent
            key={msg.id}
            message={msg}
            onAddToCart={handleAddToCheckout}
            onCheckout={
              msg.checkout?.status !== "ready_for_complete"
                ? handleStartPayment
                : undefined
            }
            onSelectPaymentMethod={handlePaymentMethodSelected}
            onConfirmPayment={handleConfirmPayment}
            onCompletePayment={
              msg.checkout?.status === "ready_for_complete"
                ? handlePaymentMethodSelection
                : undefined
            }
            // START_CHANGE: Pass new handlers for the customer details confirmation prompt
            onUseDefaultDetails={handleUseDefaultDetails}
            onEditDetails={handleUpdateDetailsManually}
            // END_CHANGE
            isLastCheckout={index === lastCheckoutIndex}
          ></ChatMessageComponent>
        ))}
      </main>
      <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
    </div>
  );
}

export default App;