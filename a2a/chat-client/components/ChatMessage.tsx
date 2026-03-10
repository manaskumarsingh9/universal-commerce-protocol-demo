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
import {appConfig} from '@/config';
import {
  type ChatMessage,
  type Checkout,
  type PaymentInstrument,
  type Product,
  Sender,
} from '../types';
import CheckoutComponent from './Checkout';
import PaymentMethodSelector from './PaymentMethodSelector';
import ProductCard from './ProductCard';
import UserLogo from './UserLogo';

interface ChatMessageProps {
  message: ChatMessage;
  onAddToCart?: (product: Product) => Promise<void> | void;
  onCheckout?: () => void;
  onSelectPaymentMethod?: (selectedMethod: string) => void;
  onConfirmPayment?: (paymentInstrument: PaymentInstrument) => void;
  onCompletePayment?: (checkout: Checkout) => void;
  isLastCheckout?: boolean;
  onUseDefaultDetails?: () => void;
  onEditDetails?: () => void;
}

function TypingIndicator() {
  return (
    <div className="w-full my-1 justify-start">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-shrink-0">
          <img alt="logo" src={appConfig.logoUrl} className="w-8 h-8" />
        </div>
        <span className="font-semibold text-gray-700">{appConfig.name}</span>
      </div>
      <div className="ml-10 px-4 py-3 rounded-2xl shadow-sm bg-gray-200 text-gray-800 self-start inline-block">
        <div className="flex items-center space-x-2 h-5">
          <span className="h-2 w-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
          <span className="h-2 w-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
          <span className="h-2 w-2 bg-gray-400 rounded-full animate-bounce"></span>
        </div>
      </div>
    </div>
  );
}

function ChatMessageComponent({
  message,
  onAddToCart,
  onCheckout,
  onSelectPaymentMethod,
  onCompletePayment,
  isLastCheckout,
  onUseDefaultDetails,
  onEditDetails,
}: ChatMessageProps) {
  const isUser = message.sender === Sender.USER;

  if (message.isLoading) {
    return <TypingIndicator />;
  }

  // Prompt for default details
  if (message.showCustomerDetailsConfirmation && message.customerDetails && !isUser) {
    const { firstName, lastName, email, address } = message.customerDetails;
    return (
      <div className="flex w-full my-2 justify-start">
        <div className="ml-10 px-4 py-3 rounded-2xl shadow-sm bg-gray-200 text-gray-800 self-start inline-block">
          Would you like to use the default details?
          <p><strong>Name:</strong> {firstName} {lastName}</p>
          <p><strong>Email:</strong> {email}</p>
          <p><strong>Address:</strong> {address.street_address}, {address.address_locality}, {address.address_region} {address.postal_code}, {address.address_country}</p>
          <div className="mt-2 flex space-x-2">
            <button
              type="button"
              onClick={onUseDefaultDetails}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded text-sm"
            >
              Yes, proceed
            </button>
            <button
              type="button"
              onClick={onEditDetails}
              className="bg-gray-400 hover:bg-gray-500 text-white font-bold py-1 px-3 rounded text-sm"
            >
              No, update manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  // User messages are handled separately
  if (isUser) {
    return (
      <div className="flex w-full my-1 items-start gap-2 justify-end">
        <div className="max-w-xs md:max-w-md lg:max-w-2xl px-4 py-2 rounded-2xl shadow-sm bg-blue-500 text-white self-end">
          <div className="whitespace-pre-wrap break-words">{message.text}</div>
        </div>
        <div className="flex-shrink-0 pt-1">
          <UserLogo className="w-8 h-8 text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full my-1 justify-start">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-shrink-0">
          <img
            src={appConfig.logoUrl}
            alt={appConfig.name}
            className="w-8 h-8"
          />
        </div>
        <span className="font-semibold text-gray-700">{appConfig.name}</span>
      </div>
      <div className="ml-10 flex-grow min-w-0">
        {message.text && (
          <div className="max-w-xs md:max-w-md lg:max-w-2xl px-4 py-2 rounded-2xl shadow-sm bg-gray-200 text-gray-800 self-start inline-block">
            <div className="break-words whitespace-pre-wrap">
              {message.text}
            </div>
          </div>
        )}

        {message.paymentMethods && onSelectPaymentMethod && (
          <PaymentMethodSelector
            paymentMethods={message.paymentMethods}
            onSelect={onSelectPaymentMethod}
          />
        )}

        {message.products && message.products.length > 0 && (
          <div className="w-full my-1 overflow-x-auto">
            <div className="flex space-x-4 p-2">
              {message.products.map((product) => (
                <ProductCard
                  key={product.productID}
                  product={product}
                  onAddToCart={onAddToCart}
                />
              ))}
            </div>
          </div>
        )}

        {message.checkout && (
          <CheckoutComponent
            checkout={message.checkout}
            onCheckout={isLastCheckout ? onCheckout : undefined}
            onCompletePayment={isLastCheckout ? onCompletePayment : undefined}
          />
        )}
      </div>
    </div>
  );
}

export default ChatMessageComponent;
