# Copyright 2026 UCP Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""UCP."""

from typing import Any, Optional
from a2a.types import Task, TaskState, TaskStatus
from ucp_sdk.models.schemas.shopping.types.payment_instrument import (
    PaymentInstrument,
)

try:
    import stripe  # type: ignore
except Exception:
    stripe = None


class MockPaymentProcessor:
    """Mock Payment Processor simulating Merchant Agent to MPP Agent calls."""

    def process_payment(
        self, payment_data: PaymentInstrument, risk_data: Any | None = None
    ) -> Task:
        """Process the payment (mocked).

        Returns a completed Task to simulate successful payment processing.
        """
        task = Task(
            context_id="a unique context id",
            id="a unique task id",
            status=TaskStatus(state=TaskState.completed),
        )
        return task


class StripePaymentProcessor:
    """Stripe-backed Payment Processor for test mode.

    This implementation is defensive: it will try to extract an amount and
    currency from the provided `PaymentInstrument`. If required information
    is missing or the `stripe` library / API key is unavailable, it will
    log and return `None` (caller should handle failure) or raise a
    controlled response.
    """

    def __init__(self, api_key: Optional[str] = None):
        if stripe is None:
            raise RuntimeError("stripe library is not installed")
        if api_key:
            stripe.api_key = api_key

    def _extract_amount_and_currency(self, payment: PaymentInstrument) -> tuple[int, str]:
        """Extract amount (in cents) and currency from a PaymentInstrument.

        Uses defensive defaults if fields are missing.
        """
        # Try common fields; the PaymentInstrument shape may vary depending on
        # the front-end. We attempt a best-effort extraction.
        amount = None
        currency = "usd"

        # PaymentInstrument might expose a 'root' or dict-like structure
        try:
            root = getattr(payment, "root", None) or payment
        except Exception:
            root = payment

        # common patterns: amount (in cents or dollars) or price object
        if hasattr(root, "amount") and root.amount is not None:
            amount = int(root.amount)
        elif isinstance(root, dict) and "amount" in root:
            amount = int(root["amount"])
        # fallback: look for 'total' or 'value'
        elif isinstance(root, dict) and "total" in root:
            amount = int(root["total"])

        # currency
        if hasattr(root, "currency") and root.currency:
            currency = str(root.currency).lower()
        elif isinstance(root, dict) and "currency" in root:
            currency = str(root["currency"]).lower()

        # If amount looks like dollars (<= 10000), assume it's dollars and
        # convert to cents; otherwise assume it's already in cents.
        if amount is None:
            amount = 1159  # $1.00 default in cents
        elif amount <= 10000:
            # treat as dollars
            amount = int(amount * 100)

        return amount, currency

    def process_payment(
        self, payment_data: PaymentInstrument, risk_data: Any | None = None
    ) -> Optional[Task]:
        """Create a Stripe PaymentIntent and return a Task-like result.

        Note: This method runs in test mode using the configured API key.
        """
        # ensure stripe is available
        if stripe is None:
            raise RuntimeError("stripe library is not installed")

        try:
            amount, currency = self._extract_amount_and_currency(payment_data)

            # Create a PaymentIntent in test mode
            intent = stripe.PaymentIntent.create(
                amount=amount,
                currency=currency,
                payment_method="pm_card_visa",  # Use a test payment method
                #payment_method_types=["card"],
                confirm=True,  # Automatically confirm the payment
                automatic_payment_methods={
                    "enabled": True,
                    "allow_redirects":"never"
                },
                metadata={
                    "integration": "agentic_pay_backend",
                }
            )

            # Map to Task object similar to MockPaymentProcessor
            task = Task(
                context_id=getattr(intent, "id", "stripe-intent"),
                id=getattr(intent, "id", "stripe-intent"),
                status=TaskStatus(state=TaskState.completed),
            )
            return task
        except Exception:
            # Don't raise - let caller handle a None/exception and log appropriately
            import logging

            logging.exception("Stripe payment processing failed")
            return None
