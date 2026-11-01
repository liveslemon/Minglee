import { adService } from "./adService.js";
import { createAdSchema, reviewAdSchema } from "./adValidator.js";

export const adController = {
  async uploadImage(req, res, next) {
    try {
      const file = Array.isArray(req.files) ? req.files[0] : null;
      if (!file) {
        return res.status(400).json({ success: false, error: "Missing image file" });
      }
      const result = await adService.uploadAdImage(req.user?.id, file);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async createAd(req, res, next) {
    try {
      const validatedData = createAdSchema.parse(req.body);
      const ad = await adService.createAd(validatedData, req.user?.id);
      res.status(201).json({ success: true, data: ad });
    } catch (error) {
      next(error);
    }
  },

  async checkAvailability(req, res, next) {
    try {
      const { ad_type, date } = req.params;
      const availability = await adService.checkSlotAvailability(ad_type, date);
      res.json({ success: true, ...availability });
    } catch (error) {
      next(error);
    }
  },

  async getActiveAds(req, res, next) {
    try {
      const { placement, date, ad_type } = req.query;
      const ads = await adService.getActiveAds({ placement, date, ad_type });
      res.json({ success: true, data: ads });
    } catch (error) {
      next(error);
    }
  },

  async getAdById(req, res, next) {
    try {
      const { id } = req.params;
      const ad = await adService.getAdById(id);
      if (!ad) {
        return res.status(404).json({ success: false, error: "Ad not found" });
      }
      res.json({ success: true, data: ad });
    } catch (error) {
      next(error);
    }
  },

  async getPendingAds(req, res, next) {
    try {
      const ads = await adService.getPendingAds();
      res.json({ success: true, data: ads });
    } catch (error) {
      next(error);
    }
  },

  async reviewAd(req, res, next) {
    try {
      const { id } = req.params;
      const { action, rejection_reason } = reviewAdSchema.parse(req.body);
      const updatedAd = await adService.reviewAd(id, action, rejection_reason);
      res.json({ success: true, data: updatedAd });
    } catch (error) {
      next(error);
    }
  },

  async trackImpression(req, res, next) {
    try {
      const { id } = req.params;
      const updatedAd = await adService.trackImpression(id);
      res.json({ success: true, message: "Impression tracked", data: updatedAd });
    } catch (error) {
      next(error);
    }
  },

  async trackClick(req, res, next) {
    try {
      const { id } = req.params;
      const updatedAd = await adService.trackClick(id);
      res.json({ success: true, message: "Click tracked", data: updatedAd });
    } catch (error) {
      next(error);
    }
  }
};
